// A company's state on disk, in <project>/.worklings/. Every change is appended to events.jsonl, signed with the hub's
// key and flushed before the company acts on it; company.json holds the state folded so far, signed too, so opening
// replays only the lines after it. Proposals, which can be large, are kept beside the log in proposals/<n>.json, signed
// the same way, and a line names one by its number and its SHA-256. Anything that doesn't check out is dropped, so a
// person who edits these files can't forge a message from the stakeholder, and nothing from another company (even one
// under the same key) checks out here, because every MAC covers the company's id.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fdatasyncSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { type CompanyEvent, type CompanyState, type FoundedEvent, fold, foundedState, isCompanyEvent, type ProposalRef, reviveState } from '../core/company-state.ts';
import { OrgRefusal } from '../core/company.ts';
import type { OrgProposal } from '../core/org.ts';
import { plainPath } from '../safe-fs.ts';

export const STATE_DIR = '.worklings';
export const EVENTS_FILE = 'events.jsonl';
export const STATE_FILE = 'company.json';
export const SHOTS_DIR = 'shots';
export const PROPOSALS_DIR = 'proposals';
/** A line longer than this is dropped when the log is read, so the company never writes one. */
export const MAX_LINE_BYTES = 256 * 1024;
/** company.json is written again after this many lines, and when the company closes. */
export const SNAPSHOT_EVERY = 200;
/** A company.json bigger than this is ignored (the log is read from the start instead). */
const MAX_STATE_BYTES = 64 * 1024 * 1024;
/** A proposal bigger than this isn't kept: far past the largest PROPOSAL_LIMITS allow. */
const MAX_PROPOSAL_BYTES = 16 * 1024 * 1024;
/** The hub's key must be at least this long. */
const MIN_KEY_BYTES = 16;

type Kind = 'event' | 'state' | 'proposal';

/** How each kind of signed record starts and names its body: `{"seq":n,"event":...}`, `{"n":3,"proposal":...}`. */
const RECORDS: Record<Kind, { head: string; body: string }> = {
  event: { head: '{"seq":', body: ',"event":' },
  state: { head: '{"seq":', body: ',"state":' },
  proposal: { head: '{"n":', body: ',"proposal":' },
};
const MAC_KEY = ',"mac":"';
const MAC_HEX = 64;
/** `,"mac":"<64 hex>"}` */
const TAIL = MAC_KEY.length + MAC_HEX + 2;
const SHOT_ID = /^s-\d{1,12}$/;

export interface Store {
  readonly state: CompanyState;
  /**
   * Appends the events as one line, flushed to disk, then folds them in. Proposals go to their own files first. Refuses
   * (OrgRefusal) a line too big to keep.
   */
  append(events: readonly CompanyEvent[]): CompanyState;
  /** Writes company.json now: a temporary file, then a rename over the old one. */
  snapshot(): void;
  close(): void;
  /** Saves a shared screenshot as .worklings/shots/<id>.png. */
  saveShot(id: string, png: Uint8Array): void;
  removeShot(id: string): void;
  /** The screenshots on disk, by id. */
  shotIds(): string[];
}

interface StoreOptions {
  root: string;
  key: Uint8Array;
  /** One sentence per problem the company carries on after; never the contents of a line. */
  warn: (message: string) => void;
}

function sign(key: Uint8Array, kind: Kind, companyId: string, n: number, body: string): string {
  return createHmac('sha256', key).update(`worklings-${kind}\n${companyId}\n${n}\n`).update(body).digest('hex');
}

function checks(key: Uint8Array, kind: Kind, companyId: string, n: number, body: string, mac: string): boolean {
  const expected = Buffer.from(sign(key, kind, companyId, n, body), 'hex');
  const given = Buffer.from(mac, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** `{"seq":n,"event":{...},"mac":"<hex>"}`: the body's exact text is what the MAC covers, so nothing is re-serialized. */
const wrap = (kind: Kind, n: number, body: string, mac: string): string => `${RECORDS[kind].head}${n}${RECORDS[kind].body}${body}${MAC_KEY}${mac}"}`;

/** The parts of a signed record, or null when it isn't one. */
function unwrap(text: string, kind: Kind): { n: number; body: string; mac: string } | null {
  const { head, body: bodyKey } = RECORDS[kind];
  if (!text.startsWith(head) || text.length < head.length + bodyKey.length + TAIL + 2) return null;
  const numberEnd = text.indexOf(',', head.length);
  if (numberEnd === -1) return null;
  const numberText = text.slice(head.length, numberEnd);
  if (!/^[1-9]\d{0,14}$/.test(numberText) || !text.startsWith(bodyKey, numberEnd)) return null;
  const tail = text.length - TAIL;
  if (tail <= numberEnd + bodyKey.length || !text.startsWith(MAC_KEY, tail) || !text.endsWith('"}')) return null;
  const mac = text.slice(tail + MAC_KEY.length, text.length - 2);
  if (!/^[0-9a-f]{64}$/.test(mac)) return null;
  return { n: Number(numberText), body: text.slice(numberEnd + bodyKey.length, tail), mac };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // a damaged record: the caller counts it as dropped
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRef = (v: unknown): v is ProposalRef => isObj(v) && Number.isSafeInteger(v.n) && (v.n as number) > 0 && typeof v.hash === 'string' && /^[0-9a-f]{64}$/.test(v.hash);

/**
 * Reads a file line by line, 64 KB at a time, so a huge line never sits in memory: a line over `max` bytes comes to
 * `each` as null. Says whether the file ended with a newline (a crash can leave half a line at the end).
 */
function eachLine(path: string, max: number, each: (line: string | null) => void): { endsWithNewline: boolean; empty: boolean } {
  const fd = openSync(path, 'r');
  const chunk = Buffer.alloc(64 * 1024);
  let parts: Buffer[] = [];
  let size = 0;
  let over = false;
  let total = 0;
  let lastByte = -1;
  const emit = () => {
    if (over) each(null);
    else if (size > 0) each(Buffer.concat(parts, size).toString('utf8').replace(/\r$/, ''));
    parts = [];
    size = 0;
    over = false;
  };
  try {
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      total += n;
      lastByte = chunk[n - 1] ?? -1;
      const view = chunk.subarray(0, n);
      let at = 0;
      while (at < n) {
        const newline = view.indexOf(0x0a, at);
        const end = newline === -1 ? n : newline;
        if (!over) {
          // One byte over the cap is allowed for a "\r" before the newline.
          if (size + (end - at) > max + 1) {
            over = true;
            parts = [];
            size = 0;
          } else {
            parts.push(Buffer.from(view.subarray(at, end)));
            size += end - at;
          }
        }
        if (newline === -1) break;
        emit();
        at = newline + 1;
      }
    }
    if (size > 0 || over) emit();
  } finally {
    closeSync(fd);
  }
  return { endsWithNewline: lastByte === 0x0a, empty: total === 0 };
}

function writeAll(fd: number, data: string | Uint8Array): void {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  for (let at = 0; at < bytes.byteLength; ) at += writeSync(fd, bytes, at, bytes.byteLength - at);
}

function checkKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.byteLength < MIN_KEY_BYTES) throw new Error(`The hub's key must be at least ${MIN_KEY_BYTES} bytes.`);
}

/** Makes .worklings/ with a .gitignore holding `*`, so the folder never reaches git. Refuses a link (safe-fs.ts). */
export function prepareStateDir(root: string): string {
  const dir = plainPath(root, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = plainPath(root, `${STATE_DIR}/.gitignore`);
  if (!existsSync(ignore) || readFileSync(ignore, 'utf8') !== '*\n') writeFileSync(ignore, '*\n');
  return dir;
}

/** Whether a folder holds a company. */
export function hasCompany(root: string): boolean {
  return existsSync(join(root, STATE_DIR, EVENTS_FILE));
}

/** Where a shared screenshot lives, for the hub's route; null for an id the company never makes. */
export function screenshotFile(root: string, id: string): string | null {
  return SHOT_ID.test(id) ? plainPath(root, `${STATE_DIR}/${SHOTS_DIR}/${id}.png`) : null;
}

const proposalFile = (root: string, n: number): string => plainPath(root, `${STATE_DIR}/${PROPOSALS_DIR}/${n}.json`);

/** A company's id as every part can use it: no "--", which git keeps between a company and a task. */
const COMPANY_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/;
const companyIdOf = (v: unknown): string | null => (typeof v === 'string' && COMPANY_ID.test(v) && !v.includes('--') ? v : null);

/** The first line of a file, read on its own and never past `max` bytes; null when there is none or it is longer. */
function firstLineOf(path: string, max: number): string | null {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(max + 2);
    let size = 0;
    for (let n = 1; n > 0 && size < buffer.length; size += n) {
      n = readSync(fd, buffer, size, buffer.length - size, null);
      const newline = buffer.subarray(size, size + n).indexOf(0x0a);
      if (newline !== -1) return buffer.subarray(0, size + newline).toString('utf8').replace(/\r$/, '');
    }
    return size > 0 && size <= max ? buffer.subarray(0, size).toString('utf8') : null;
  } finally {
    closeSync(fd);
  }
}

/**
 * The id of the company in a folder, read without opening it or writing anything: from the log's first line, else
 * company.json. Null when there is no company, or what is there isn't shaped like one; with the hub's key, also when it
 * doesn't check out.
 */
export function companyIdAt(root: string, key?: Uint8Array): string | null {
  try {
    const log = plainPath(root, `${STATE_DIR}/${EVENTS_FILE}`);
    if (!existsSync(log)) return null;
    const line = firstLineOf(log, MAX_LINE_BYTES);
    const parts = line === null ? null : unwrap(line, 'event');
    const founded = parts ? parseJson(parts.body) : undefined;
    if (parts && parts.n === 1 && isCompanyEvent(founded) && founded.type === 'founded') {
      const id = companyIdOf(founded.id);
      return id && (!key || checks(key, 'event', id, 1, parts.body, parts.mac)) ? id : null;
    }
    const snapshot = plainPath(root, `${STATE_DIR}/${STATE_FILE}`);
    if (!existsSync(snapshot) || statSync(snapshot).size > MAX_STATE_BYTES) return null;
    const state = unwrap(readFileSync(snapshot, 'utf8').replace(/\r?\n$/, ''), 'state');
    const raw = state ? parseJson(state.body) : undefined;
    const id = companyIdOf(isObj(raw) ? raw.id : undefined);
    return id && state && (!key || checks(key, 'state', id, state.n, state.body, state.mac)) ? id : null;
  } catch {
    // A link where the folder should be, or a file that can't be read: there's no company to name here.
    return null;
  }
}

/** Writes a file whole or not at all: a temporary file beside it, flushed, then renamed over it. */
function writeAtomically(dir: string, target: string, data: string | Uint8Array): void {
  const temp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(temp, 'w');
    try {
      writeAll(fd, data);
      fdatasyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** A proposal kept beside the log, checked against its MAC and the hash its line gives; null when either fails. */
function readProposal(o: StoreOptions, companyId: string, ref: ProposalRef): OrgProposal | null {
  const path = proposalFile(o.root, ref.n);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_PROPOSAL_BYTES) return null;
  const parts = unwrap(readFileSync(path, 'utf8').replace(/\r?\n$/, ''), 'proposal');
  if (!parts || parts.n !== ref.n || sha256(parts.body) !== ref.hash || !checks(o.key, 'proposal', companyId, parts.n, parts.body, parts.mac)) return null;
  const proposal = parseJson(parts.body);
  if (!isObj(proposal)) return null;
  // Signed by the company when it was proposed, so its shape is the one the org flow checked then.
  const checked: unknown = proposal;
  return checked as OrgProposal;
}

class FileStore implements Store {
  state: CompanyState;
  private readonly root: string;
  private readonly dir: string;
  private readonly key: Uint8Array;
  private readonly warn: (message: string) => void;
  private readonly fd: number;
  private seq: number;
  private snapshotSeq: number;
  private closed = false;

  constructor(o: StoreOptions & { dir: string; fd: number; state: CompanyState; seq: number; snapshotSeq: number }) {
    this.root = o.root;
    this.dir = o.dir;
    this.key = o.key;
    this.warn = o.warn;
    this.fd = o.fd;
    this.state = o.state;
    this.seq = o.seq;
    this.snapshotSeq = o.snapshotSeq;
  }

  append(events: readonly CompanyEvent[]): CompanyState {
    if (this.closed) throw new OrgRefusal('closed', 'The company is closed.');
    if (events.length === 0) return this.state;
    const event: CompanyEvent = events.length === 1 && events[0] ? events[0] : { type: 'batch', events: [...events] };
    let next = this.state.proposalCount;
    const kept: number[] = [];
    const { line: onDisk, folded } = this.keepProposals(event, () => {
      next += 1;
      kept.push(next);
      return next;
    });
    const body = JSON.stringify(onDisk);
    const seq = this.seq + 1;
    const line = wrap('event', seq, body, sign(this.key, 'event', this.state.id, seq, body));
    const bytes = Buffer.byteLength(line);
    if (bytes > MAX_LINE_BYTES) {
      for (const n of kept) rmSync(proposalFile(this.root, n), { force: true });
      throw new OrgRefusal('invalid', `That is too big for the office to keep: ${Math.ceil(bytes / 1024)} KB, where the most is ${MAX_LINE_BYTES / 1024} KB.`);
    }
    try {
      writeAll(this.fd, `${line}\n`);
      fdatasyncSync(this.fd);
    } catch (error) {
      // End whatever half line made it to disk, so the next line starts on its own (the half one is dropped on open).
      try {
        writeAll(this.fd, '\n');
      } catch {
        // The disk refuses writes altogether; the error below says why.
      }
      throw error;
    }
    this.seq = seq;
    this.state = fold(this.state, folded);
    if (this.seq - this.snapshotSeq >= SNAPSHOT_EVERY) this.snapshot();
    return this.state;
  }

  /**
   * Writes each proposal in an event to its own signed file, and gives the event as the line holds it (the proposal's
   * number and hash) and as the state folds it (the proposal itself, with the same reference).
   */
  private keepProposals(event: CompanyEvent, next: () => number): { line: unknown; folded: CompanyEvent } {
    if (event.type === 'batch') {
      const parts = event.events.map((e) => this.keepProposals(e, next));
      return { line: { type: 'batch', events: parts.map((p) => p.line) }, folded: { type: 'batch', events: parts.map((p) => p.folded) } };
    }
    if (event.type !== 'proposal' && event.type !== 'proposal-edited') return { line: event, folded: event };
    const n = next();
    const body = JSON.stringify(event.proposal);
    const text = `${wrap('proposal', n, body, sign(this.key, 'proposal', this.state.id, n, body))}\n`;
    if (Buffer.byteLength(text) > MAX_PROPOSAL_BYTES) throw new OrgRefusal('invalid', `That proposal is too big to keep: the most is ${MAX_PROPOSAL_BYTES / (1024 * 1024)} MB.`);
    const dir = plainPath(this.root, `${STATE_DIR}/${PROPOSALS_DIR}`);
    mkdirSync(dir, { recursive: true });
    writeAtomically(dir, proposalFile(this.root, n), text);
    const ref: ProposalRef = { n, hash: sha256(body) };
    const { proposal: _proposal, ...rest } = event;
    return { line: { ...rest, ref }, folded: { ...event, ref } };
  }

  snapshot(): void {
    if (this.seq === this.snapshotSeq && existsSync(join(this.dir, STATE_FILE))) return;
    const body = JSON.stringify(this.state);
    const text = wrap('state', this.seq, body, sign(this.key, 'state', this.state.id, this.seq, body));
    try {
      writeAtomically(this.dir, plainPath(this.root, `${STATE_DIR}/${STATE_FILE}`), `${text}\n`);
      this.snapshotSeq = this.seq;
    } catch (error) {
      // The log still holds everything; the next snapshot tries again.
      this.warn(`Couldn't write ${join(this.dir, STATE_FILE)}: ${(error as Error).message}`);
    }
  }

  close(): void {
    if (this.closed) return;
    this.snapshot();
    this.closed = true;
    closeSync(this.fd);
  }

  saveShot(id: string, png: Uint8Array): void {
    const file = screenshotFile(this.root, id);
    if (!file) throw new Error(`${id} is not a screenshot id.`);
    const dir = plainPath(this.root, `${STATE_DIR}/${SHOTS_DIR}`);
    mkdirSync(dir, { recursive: true });
    writeAtomically(dir, file, png);
  }

  removeShot(id: string): void {
    const file = screenshotFile(this.root, id);
    if (file) rmSync(file, { force: true });
  }

  shotIds(): string[] {
    const dir = join(this.dir, SHOTS_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.png') && SHOT_ID.test(name.slice(0, -4)))
      .map((name) => name.slice(0, -4));
  }
}

/** A new company's log, starting with the event that founds it. */
export function createStore(o: StoreOptions & { founded: FoundedEvent }): Store {
  checkKey(o.key);
  const dir = prepareStateDir(o.root);
  const path = plainPath(o.root, `${STATE_DIR}/${EVENTS_FILE}`);
  if (existsSync(path) && statSync(path).size > 0) throw new OrgRefusal('conflict', `A company already runs in ${o.root}; open it from the lobby.`);
  const fd = openSync(path, 'a');
  const body = JSON.stringify(o.founded);
  try {
    writeAll(fd, `${wrap('event', 1, body, sign(o.key, 'event', o.founded.id, 1, body))}\n`);
    fdatasyncSync(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return new FileStore({ ...o, dir, fd, state: foundedState(o.founded), seq: 1, snapshotSeq: 0 });
}

/** The signed state in company.json, or null (with a warning) when it is missing, damaged or not this company's. */
function readSnapshot(o: StoreOptions, path: string, companyId: string): { seq: number; state: CompanyState } | null {
  if (!existsSync(path)) return null;
  const ignored = (why: string) => {
    o.warn(`Ignored ${path} (${why}); the company is read from its log instead.`);
    return null;
  };
  if (statSync(path).size > MAX_STATE_BYTES) return ignored('it is too big');
  const parts = unwrap(readFileSync(path, 'utf8').replace(/\r?\n$/, ''), 'state');
  if (!parts || !checks(o.key, 'state', companyId, parts.n, parts.body, parts.mac)) return ignored("it doesn't check out with this hub's key");
  const state = reviveState(parseJson(parts.body));
  if (!state || state.id !== companyId) return ignored("it isn't this company's");
  return { seq: parts.n, state };
}

/**
 * An event as the state folds it: each proposal it names read back from its file. Null when one doesn't check out
 * (its number is passed to `bad`), so the line is dropped as a damaged one would be.
 */
function withProposals(event: CompanyEvent, read: (ref: ProposalRef) => OrgProposal | null, bad: (n: number) => void): CompanyEvent | null {
  if (event.type === 'batch') {
    const events: CompanyEvent[] = [];
    for (const inner of Array.isArray(event.events) ? event.events : []) {
      if (!isCompanyEvent(inner)) return null;
      const resolved = withProposals(inner, read, bad);
      if (!resolved) return null;
      events.push(resolved);
    }
    return { type: 'batch', events };
  }
  if (event.type !== 'proposal' && event.type !== 'proposal-edited') return event;
  // A line written before proposals moved out of the log holds its proposal itself.
  if (event.ref === undefined) return isObj(event.proposal) ? event : null;
  if (!isRef(event.ref)) return null;
  const proposal = read(event.ref);
  if (!proposal) {
    bad(event.ref.n);
    return null;
  }
  return { ...event, proposal };
}

/**
 * Opens a company's log: the state in company.json, then every later line that checks out. Lines that don't (edited,
 * damaged, replayed out of order or over the size cap) are dropped with one warning for the file, which never shows
 * what they held; so are lines that name a proposal file that doesn't check out, with a warning for that file.
 */
export function openStore(o: StoreOptions): Store {
  checkKey(o.key);
  const path = plainPath(o.root, `${STATE_DIR}/${EVENTS_FILE}`);
  if (!existsSync(path)) throw new Error(`There's no company in ${o.root}: ${STATE_DIR}/${EVENTS_FILE} is missing.`);
  // Puts back a .gitignore someone deleted.
  const dir = prepareStateDir(o.root);
  // Set while the lines are read (a callback), so the type is spelled out rather than narrowed to null.
  let state = null as CompanyState | null;
  let companyId = '';
  let snapshotSeq = 0;
  let last = 0;
  let dropped = 0;
  const badProposals = new Set<number>();
  const unreadable = () => new Error(`The company's log in ${dir} doesn't check out with this hub's key, so the company can't be opened.`);
  const read = eachLine(path, MAX_LINE_BYTES, (line) => {
    if (line !== null && line.trim() === '') return;
    const parts = line === null ? null : unwrap(line, 'event');
    if (state === null) {
      // The first line founds the company and names it; every other MAC covers that name.
      const founded = parts ? parseJson(parts.body) : undefined;
      const valid = parts && parts.n === 1 && isCompanyEvent(founded) && founded.type === 'founded' && typeof founded.id === 'string';
      if (!valid || !checks(o.key, 'event', founded.id, 1, parts.body, parts.mac)) {
        throw unreadable();
      }
      companyId = founded.id;
      const snapshot = readSnapshot(o, plainPath(o.root, `${STATE_DIR}/${STATE_FILE}`), companyId);
      state = snapshot?.state ?? foundedState(founded);
      snapshotSeq = snapshot?.seq ?? 0;
      last = Math.max(1, snapshotSeq);
      return;
    }
    if (parts && parts.n <= snapshotSeq) return; // already in company.json
    if (!parts || parts.n <= last || !checks(o.key, 'event', companyId, parts.n, parts.body, parts.mac)) {
      dropped += 1;
      return;
    }
    // This hub signed the line at this number, so the number is taken even when the line is dropped below (for a
    // proposal file that doesn't check out, say): the next line written never shares it.
    last = parts.n;
    const event = parseJson(parts.body);
    if (!isCompanyEvent(event) || event.type === 'founded') {
      dropped += 1;
      return;
    }
    const resolved = withProposals(event, (ref) => readProposal(o, companyId, ref), (n) => badProposals.add(n));
    if (!resolved) return;
    state = fold(state, resolved);
  });
  if (state === null) throw unreadable();
  if (dropped > 0) {
    o.warn(`Dropped ${dropped} line${dropped === 1 ? '' : 's'} of ${path} that didn't check out with this hub's key (edited, damaged or written elsewhere).`);
  }
  for (const n of badProposals) {
    o.warn(`Dropped ${join(dir, PROPOSALS_DIR, `${n}.json`)} and the change that named it: it didn't check out with this hub's key (edited, damaged or missing).`);
  }
  const fd = openSync(path, 'a');
  // A crash can leave half a line at the end; end it, so the next line starts on its own.
  if (!read.endsWithNewline && !read.empty) writeAll(fd, '\n');
  return new FileStore({ ...o, dir, fd, state, seq: last, snapshotSeq });
}
