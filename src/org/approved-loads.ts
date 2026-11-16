// What each person's desk may load, as the stakeholder approved it. studio.yaml is a project file: anyone who can change
// it (a repository that comes with its own .claude/studio.yaml, a pull request) could give a role tools and MCP servers
// the stakeholder never saw. So the assignment that counts is the one recorded in the company's own state when the
// stakeholder starts the company or approves a reshape (`recordApproved`), and a desk uses a role's `loads` from the file
// only when it matches that record (`approvedLoads`). Anything else gets the defaults of the person's level, and the log
// says the file's assignment wasn't approved.
//
// The record is signed with the hub's key (~/.worklings/hub.key, outside every project), as the company's log is, so a
// record written by hand or by a desk grants nothing: a record that is unsigned or fails its check counts as no record, and
// the stakeholder approves the org again to make a new one. The hub names each company's key here (`useApprovalKey`) when
// it creates or opens the company; with no key named, nothing is recorded and nothing counts as approved.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Loads, resolveLoads, sameLoads } from '../core/loads.ts';
import type { Level } from '../core/studio.ts';
import { plainPath } from '../safe-fs.ts';

/** Inside the company's state folder, which the office keeps out of git. */
const FILE = '.worklings/approved-loads.json';
const MAX_BYTES = 1024 * 1024;
/** The record's format: 2 is signed. 1 (unsigned, written only by builds of 0.2 before it was signed) is refused. */
const VERSION = 2;

type Role = { id: string; level?: Level; loads?: Loads };

/** The hub's key for each company folder, by the folder's full path (in lower case on Windows, where case doesn't matter). */
const keys = new Map<string, Uint8Array>();
const keyOf = (root: string): string => (process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root));

/** Names the key that signs and checks the record in `root`: the hub's, given when it creates or opens the company there. */
export function useApprovalKey(root: string, key: Uint8Array): void {
  keys.set(keyOf(root), key);
}

/** The MAC over the roles as they are written, tied to the folder so a record copied from another company counts for nothing. */
function sign(key: Uint8Array, root: string, body: string): string {
  return createHmac('sha256', key).update(`worklings-approved-loads\n${VERSION}\n${keyOf(root)}\n`).update(body).digest('hex');
}

type Read = { roles: Record<string, unknown> } | { problem: 'missing' | 'unsigned' };

/** The record, by role id, once its signature checks; else why there is none. */
function readRecord(root: string): Read {
  let text: string;
  try {
    const file = plainPath(root, FILE);
    if (!existsSync(file)) return { problem: 'missing' };
    text = readFileSync(file, 'utf8');
  } catch {
    return { problem: 'unsigned' };
  }
  const key = keys.get(keyOf(root));
  if (key === undefined || text.length > MAX_BYTES) return { problem: 'unsigned' };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { problem: 'unsigned' };
    const { version, roles, mac } = value as Record<string, unknown>;
    if (version !== VERSION || typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)) return { problem: 'unsigned' };
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) return { problem: 'unsigned' };
    const expected = Buffer.from(sign(key, root, JSON.stringify(roles)), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(mac, 'hex'))) return { problem: 'unsigned' };
    return { roles: Object.assign(Object.create(null) as Record<string, unknown>, roles) };
  } catch {
    return { problem: 'unsigned' };
  }
}

/**
 * Writes down what the roles load now, as the stakeholder has just approved it, signed with the company's key. Replaces the
 * record; atomic. Writes nothing when nothing is approved and there is no record yet, and nothing without a key (then no
 * role's file counts as approved).
 */
export function recordApproved(root: string, roles: readonly Role[]): void {
  const file = plainPath(root, FILE);
  const entries = roles.filter((r) => r.loads !== undefined).map((r) => [r.id, r.loads]);
  // Nothing approved and no record before: no record is the same thing, and no file is written.
  if (entries.length === 0 && !existsSync(file)) return;
  const key = keys.get(keyOf(root));
  if (key === undefined) return;
  const body = JSON.stringify(Object.fromEntries(entries));
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: VERSION, roles: JSON.parse(body) as unknown, mac: sign(key, root, body) }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** What was already said, so a tampered file is reported once and not at every turn. */
const said = new Set<string>();

/**
 * The role's `loads` from studio.yaml when they are what the stakeholder approved (the same things loaded, in any order,
 * defaults filled in); undefined otherwise, which gives the person their level's defaults. `say` hears one sentence, once,
 * when the file's assignment isn't the approved one, and says so when the record itself isn't one the office signed.
 */
export function approvedLoads(root: string, role: Role | undefined, say: (sentence: string) => void = () => {}): Loads | undefined {
  if (!role?.loads) return undefined;
  const record = readRecord(root);
  const approved = 'roles' in record ? record.roles[role.id] : undefined;
  const a = resolveLoads(role.loads, role.level);
  const b = resolveLoads(typeof approved === 'object' && approved !== null && !Array.isArray(approved) ? (approved as Loads) : undefined, role.level);
  if (sameLoads(a, b)) return role.loads;
  const sentence =
    'problem' in record && record.problem === 'unsigned'
      ? `The record of what each desk may load (${FILE}) isn't one this computer's Worklings signed (it was changed by hand, or written by an earlier build), so ${role.id}'s desk gets the standard tools and servers for their level until the stakeholder approves the org again.`
      : `The tools and servers .claude/studio.yaml gives ${role.id} weren't approved by the stakeholder, so ${role.id}'s desk gets the standard ones for their level.`;
  const key = `${root}\n${role.id}\n${JSON.stringify(a)}`;
  if (!said.has(key)) {
    said.add(key);
    say(sentence);
  }
  return undefined;
}
