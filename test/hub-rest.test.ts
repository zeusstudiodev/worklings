// The plan's usage limit rests every company of a hub together, with the real parts and only Claude Code faked
// (test/fake-desk.mjs): one company's CEO meets the limit, the other company rests until the same reset, a company
// added meanwhile rests from its first moment, and they all wake together.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import type { CompanyView, LobbyView } from '../src/core/company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import { tempDir } from './library-kit.ts';
import { FAKE_DESK } from './runtime-kit.ts';

const TOKEN = 'rest-token-0123456789abcdefghijklmnopqr';
/** From the limit to the plan's reset. */
const RESET_MS = 2_000;
/** A wait long enough for a desk to start on a busy machine. */
const SLOW = { timeout: 60_000, interval: 50 };

const SCRIPT = {
  default: [{ say: 'On it.' }],
  scenarios: {
    limit: [{ limit: { status: 'rejected', resetsInMs: RESET_MS, rateLimitType: 'five_hour', utilization: 1 } }, { fail: 'usage-limit' }],
  },
};

let hub: RunningHub;
let projects: string;
/**
 * The hub's clock: the real time, except while the test holds it, so the rest can't run out before the company added
 * during it has been made, however busy the machine is.
 */
let heldAt: number | null = null;
const now = () => heldAt ?? Date.now();

const call = async (path: string, body?: unknown) => {
  const res = await fetch(`${hub.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as unknown };
};

async function company(id: string): Promise<CompanyView> {
  const snapshot = (await call(`api/c/${id}/state`)).body as Snapshot;
  if (!snapshot.company) throw new Error(`${id} has no company`);
  return snapshot.company;
}

const lobby = async () => (await call('api/lobby')).body as LobbyView;
/** The CEO's first message: the opening turn the company was founded with. */
const opening = (view: CompanyView) => view.messages.find((m) => m.to === 'ceo');

beforeAll(async () => {
  const dir = tempDir('worklings-rest-');
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', gitconfig);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  const script = join(dir, 'script.json');
  writeFileSync(script, JSON.stringify(SCRIPT));
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  projects = join(dir, 'projects');
  mkdirSync(projects);
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN'].includes(name.toUpperCase()));
  const env = {
    ...Object.fromEntries(kept), WORKLINGS_CLAUDE: FAKE_DESK, FAKE_DESK_SCRIPT: script, FAKE_DESK_LOG: join(dir, 'desk.jsonl'), FAKE_DESK_SESSIONS: join(dir, 'sessions'),
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
  };
  hub = await startHub({
    port: 0, token: TOKEN, webDir: null, library: loadLibrary(), home: join(dir, 'home'), env, claudeHome: join(dir, 'claude'), tickMs: 25, now,
    desks: { scratch }, aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') },
  });
}, 120_000);

afterAll(async () => {
  heldAt = null;
  await hub?.close();
  vi.unstubAllEnvs();
}, 120_000);

describe("the plan's usage limit", () => {
  it('rests every company until its reset, holds a company added meanwhile, and wakes them together', { timeout: 180_000 }, async () => {
    expect((await call('api/companies', { folder: join(projects, 'cafe'), prompt: 'A café site with pickup orders' })).status).toBe(201);
    await vi.waitFor(async () => expect(opening(await company('cafe'))?.deliveredAt).toBeTypeOf('number'), SLOW);
    // The second company's CEO meets the plan's limit on its first turn. The hub's clock stands still from before the
    // limit until the company added during the rest has been checked.
    const heldFrom = Date.now();
    heldAt = heldFrom;
    expect((await call('api/companies', { folder: join(projects, 'plant-pal'), prompt: 'A plant care app [fake:limit]' })).status).toBe(201);
    const rest = await vi.waitFor(async () => {
      const r = (await lobby()).hub.rest;
      if (!r) throw new Error('the hub is not resting yet');
      return r;
    }, SLOW);
    expect((await company('plant-pal')).pause).toMatchObject({ reason: 'usage-limit', until: rest.until });
    expect((await company('cafe')).pause).toMatchObject({ reason: 'usage-limit', until: rest.until });
    // A company added while the plan rests rests too: its CEO's first turn waits for the reset.
    expect((await call('api/companies', { folder: join(projects, 'shop'), prompt: 'A small online shop' })).status).toBe(201);
    const shop = await company('shop');
    expect(shop.pause).toMatchObject({ reason: 'usage-limit', until: rest.until });
    expect(opening(shop)?.deliveredAt).toBeNull();
    expect((await lobby()).hub.rest).toEqual(rest);
    // At the reset they all wake, and the turn that waited goes out. Timers set while the clock stood still wait from
    // then to the reset, so once it runs again they fire within that long.
    heldAt = null;
    const wake = { ...SLOW, timeout: rest.until - heldFrom + SLOW.timeout };
    await vi.waitFor(async () => expect((await Promise.all(['cafe', 'plant-pal', 'shop'].map(company))).map((v) => v.pause)).toEqual([null, null, null]), wake);
    await vi.waitFor(async () => expect(opening(await company('shop'))?.deliveredAt).toBeTypeOf('number'), SLOW);
    expect((await lobby()).hub.rest).toBeNull();
  });
});
