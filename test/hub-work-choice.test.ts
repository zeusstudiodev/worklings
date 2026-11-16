// 0.2.0: how a new company's work runs is its creator's choice (the start form's, or `worklings new --team`): one Claude
// Code session (plain) or the experimental team (the solo shape). The company keeps the choice in its own state, so it
// reopens as it was made; a hub started with a shape (WORKLINGS_SHAPE, a developer's override) founds that shape instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { type HubOptions, type RunningHub, startHub } from '../src/hub/index.ts';
import { tempDir } from './library-kit.ts';
import { FAKE_DESK } from './runtime-kit.ts';

const TOKEN = 'choice-token-0123456789abcdefghijklmnopq';
const running: RunningHub[] = [];

afterEach(async () => {
  for (const hub of running.splice(0)) await hub.close();
}, 120_000);

function world() {
  const dir = tempDir('worklings-choice-');
  const script = join(dir, 'script.json');
  writeFileSync(script, JSON.stringify({ default: [{ say: 'On it.' }] }));
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  const projects = join(dir, 'projects');
  mkdirSync(projects);
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN'].includes(name.toUpperCase()));
  const env = { ...Object.fromEntries(kept), WORKLINGS_CLAUDE: FAKE_DESK, FAKE_DESK_SCRIPT: script, FAKE_DESK_SESSIONS: join(dir, 'sessions'), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
  const open = async (over: Partial<HubOptions> = {}) => {
    const hub = await startHub({
      port: 0, token: TOKEN, webDir: null, library: loadLibrary(), home: join(dir, 'home'), env, claudeHome: join(dir, 'claude'), tickMs: 25,
      desks: { scratch }, aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') }, ...over,
    });
    running.push(hub);
    return hub;
  };
  return { projects, open };
}

async function call(hub: RunningHub, path: string, body?: unknown) {
  const res = await fetch(`${hub.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const shapeOf = async (hub: RunningHub, id: string) => ((await call(hub, `api/c/${id}/state`)).body as unknown as Snapshot).company?.shape;

describe('how the work runs', () => {
  it('founds one Claude Code session for "plain" and the solo team for "team"', { timeout: 120_000 }, async () => {
    const w = world();
    const hub = await w.open();
    const plain = await call(hub, 'api/companies', { folder: join(w.projects, 'one'), prompt: 'A reading list CLI.', work: 'plain' });
    const team = await call(hub, 'api/companies', { folder: join(w.projects, 'two'), prompt: 'A reading list CLI.', work: 'team' });
    expect(await shapeOf(hub, String(plain.body.id))).toBe('plain');
    expect(await shapeOf(hub, String(team.body.id))).toBe('solo');
  });

  it('refuses a choice it does not know', { timeout: 120_000 }, async () => {
    const w = world();
    const hub = await w.open();
    const refused = await call(hub, 'api/companies', { folder: join(w.projects, 'one'), prompt: 'A reading list CLI.', work: 'swarm' });
    expect(refused.status).toBe(400);
  });

  it('keeps the choice in the company, so it reopens as it was made, even under a hub that overrides new ones', { timeout: 180_000 }, async () => {
    const w = world();
    const first = await w.open();
    const team = String((await call(first, 'api/companies', { folder: join(w.projects, 'team'), prompt: 'A reading list CLI.', work: 'team' })).body.id);
    await first.close();
    running.splice(running.indexOf(first), 1);
    // The hub opens the companies its home remembers when it starts.
    const second = await w.open({ shape: 'plain' });
    await expect.poll(() => shapeOf(second, team), { timeout: 60_000 }).toBe('solo');
  });

  it("lets the developer's override (WORKLINGS_SHAPE) win over the choice a new company is made with", { timeout: 120_000 }, async () => {
    const w = world();
    const hub = await w.open({ shape: 'classic' });
    const id = String((await call(hub, 'api/companies', { folder: join(w.projects, 'one'), prompt: 'A reading list CLI.', work: 'plain' })).body.id);
    expect(await shapeOf(hub, id)).toBe('classic');
  });
});
