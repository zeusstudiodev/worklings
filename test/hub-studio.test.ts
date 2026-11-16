// v0.3, the studio chat's security in the hub: its desk has its own token, which reaches only its own tools (never a
// company's org tools, and a company desk's token never reaches its tools); it asks for nothing, so any permission it
// asks is a no; its routes need the hub's token and the hub's own origin; and with the fake desk standing in for Claude
// Code, a turn shows its cost and an idle chat starts no desk at all.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import type { StudioLobbyView } from '../src/studio/model.ts';
import { type Fakes, fakes, TOKEN } from './hub-kit.ts';
import { miniLibrary, tempDir } from './library-kit.ts';
import { FAKE_DESK, type FakeLogEntry } from './runtime-kit.ts';

const library = loadLibrary(miniLibrary());
const hubs: RunningHub[] = [];
const SLOW = { timeout: 30_000, interval: 50 };

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.close();
});

const SCRIPT = {
  default: [{ say: 'Hello.' }],
  scenarios: {
    // What the studio desk tries that it must not have: a company's org tools, and a built-in tool that would ask.
    overreach: [{ org: 'approve_plan', arguments: { version: 1, through: null, cites: [] } }, { sayResult: 'Tried:' }],
    bash: [{ tool: 'Bash', input: { command: 'git push', description: 'Push' }, ask: true }, { say: 'Tried Bash.' }],
    list: [{ org: 'list_companies', arguments: {} }, { sayResult: 'Listed:' }],
    // Ten requests at the fake's $0.001 each: a cent.
    spend: Array.from({ length: 10 }, (_, i) => ({ say: `Step ${i + 1}.` })),
  },
};

async function hub(script: object = SCRIPT): Promise<{ hub: RunningHub; f: Fakes; logFile: string; home: string }> {
  const dir = tempDir('worklings-studio-hub-');
  const home = join(dir, 'home');
  mkdirSync(home);
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(script));
  const logFile = join(dir, 'desk.jsonl');
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN'].includes(name.toUpperCase()));
  const f = fakes();
  const running = await startHub({
    port: 0, token: TOKEN, webDir: null, library, home, make: f.make, tickMs: 10, claudeHome: tempDir('worklings-claude-'), claude: FAKE_DESK,
    env: { ...Object.fromEntries(kept), FAKE_DESK_SCRIPT: scriptFile, FAKE_DESK_LOG: logFile, FAKE_DESK_SESSIONS: join(dir, 'sessions') },
    desks: { scratch: tempDir('worklings-scratch-') },
    aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') },
  });
  hubs.push(running);
  return { hub: running, f, logFile, home };
}

const call = async (h: RunningHub, path: string, init: { body?: unknown; headers?: Record<string, string>; method?: string } = {}) => {
  const res = await fetch(`${h.url}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> };
};

const studioOf = async (h: RunningHub) => ((await call(h, 'api/lobby')).body as unknown as StudioLobbyView).studio;

async function answered(h: RunningHub, text: string) {
  expect((await call(h, 'api/studio/messages', { body: { text } })).status).toBe(202);
  return vi.waitFor(async () => {
    const s = await studioOf(h);
    expect(s.state).toBe('idle');
    expect(s.entries.at(-1)?.kind).toBe('studio');
    return s;
  }, SLOW);
}

const mcpCall = (h: RunningHub, token: string, headers: Record<string, string> = {}) =>
  fetch(`${h.url}mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }),
  });

describe('the studio chat in the hub', () => {
  it('starts no desk while nobody writes to it, and shows what each answer cost', async () => {
    const { hub: h, logFile } = await hub();
    const idle = await studioOf(h);
    expect(idle).toMatchObject({ state: 'idle', entries: [], spent: 0, model: 'sonnet' });
    expect(() => readFileSync(logFile, 'utf8')).toThrow();
    const s = await answered(h, 'Hi there.');
    expect(s.entries.map((e) => e.kind)).toEqual(['you', 'studio']);
    expect(s.entries[1]?.cost).toBeGreaterThan(0);
  });

  it("can't reach a company's org tools: its desk's server lists only the studio's own", async () => {
    const { hub: h } = await hub();
    const s = await answered(h, '[fake:overreach] Approve the plan for me.');
    expect(s.entries.at(-1)?.text).toBe('Tried: No such tool available: mcp__org__approve_plan');
  });

  it('stops a desk that came up with tools it must not have, as a Claude Code without the lean flags would start it', async () => {
    // A Claude Code that refuses the lean flags: the harness starts the next desk the standard way, with built-in tools.
    const { hub: h } = await hub({ ...SCRIPT, rejectFlags: true });
    expect((await call(h, 'api/studio/messages', { body: { text: 'Hello?' } })).status).toBe(202);
    await vi.waitFor(async () => expect((await studioOf(h)).state).toBe('failed'), SLOW);
    expect((await call(h, 'api/studio/messages', { body: { text: 'Hello again?' } })).status).toBe(202);
    const s = await vi.waitFor(async () => {
      const v = await studioOf(h);
      expect(v.problem).toMatch(/^The studio chat stopped: its desk came up with tools it must not have \(/);
      return v;
    }, SLOW);
    expect(s.entries.some((e) => e.kind === 'studio')).toBe(false);
  });

  it('is told no by the hub when its desk asks for any permission', async () => {
    const { hub: h, logFile } = await hub();
    await answered(h, '[fake:bash] Push it.');
    const asked = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry & { behavior?: string }).filter((e) => e.event === 'permission');
    expect(asked.map((e) => [e.status, e.behavior])).toEqual([[200, 'deny']]);
  });

  it("keeps tokens apart: a company desk's token reaches the org tools, never the studio's, and an unknown one nothing", async () => {
    const { hub: h, f } = await hub();
    const folder = tempDir('worklings-proj-');
    expect((await call(h, 'api/companies', { body: { folder, prompt: 'A plant care app' } })).status).toBe(201);
    const companyToken = f.switchboards[0]?.hub.issue('ceo') ?? '';
    const res = await mcpCall(h, companyToken);
    // The fake org tools answer with the caller the hub resolved: a company desk.
    expect(await res.json()).toMatchObject({ person: 'ceo' });
    expect((await mcpCall(h, 'f'.repeat(64))).status).toBe(401);
    // From a browser (any Origin) the studio's tools are never reached.
    expect((await mcpCall(h, companyToken, { origin: `${h.url.replace(/\/$/, '')}` })).status).toBe(403);
  });

  it('takes its routes only with the hub token, from its own pages, and refuses what it can not keep', async () => {
    const { hub: h } = await hub();
    expect((await call(h, 'api/studio/messages', { body: { text: 'x' }, headers: { authorization: 'Bearer nope-nope-nope-nope-nope-nope-nope' } })).status).toBe(401);
    expect((await call(h, 'api/studio/messages', { body: { text: 'x' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(h, 'api/portfolios', { body: { name: 'x' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(h, 'api/studio/messages', { body: { text: 'x', typed: true } })).body.error).toBe('This takes text, not typed.');
    expect((await call(h, 'api/studio/messages', { body: { text: '   ' } })).body.error).toBe('Say something to send.');
    expect((await call(h, 'api/studio/messages', { body: { text: 'x'.repeat(4001) } })).body.error).toBe('Keep it to 4,000 characters.');
    expect((await call(h, 'api/studio/settings', { body: { model: 'gpt' } })).body.error).toBe('The model is one of sonnet, opus, haiku.');
    expect((await call(h, 'api/studio/settings', { body: { model: 'haiku' } })).body).toEqual({ model: 'haiku', budget: 5 });
    expect((await studioOf(h)).model).toBe('haiku');
    expect((await call(h, 'api/studio/stop', { body: {} })).status).toBe(409);
    expect((await call(h, 'api/portfolios/p-nope', { body: { name: 'y' } })).status).toBe(404);
    // A malformed escape in a portfolio's address is a portfolio that isn't there, never a server error.
    for (const method of ['POST', 'DELETE']) {
      const bad = await call(h, 'api/portfolios/%E0%A4%A', { method, ...(method === 'POST' ? { body: { name: 'y' } } : {}) });
      expect([bad.status, bad.body.error]).toEqual([404, "That portfolio isn't in the lobby any more."]);
    }
  });

  it('stops taking messages once it has spent its own budget, says how to raise it, and keeps the budget across a restart', async () => {
    const first = await hub();
    const h = first.hub;
    expect((await studioOf(h)).budget).toBe(5);
    expect((await call(h, 'api/studio/settings', { body: { budget: 0 } })).body.error).toBe('The budget is a dollar amount from $0.01 to $10,000.');
    expect((await call(h, 'api/studio/settings', { body: { budget: '1' } })).status).toBe(400);
    expect((await call(h, 'api/studio/settings', { body: {} })).body.error).toBe('Send model, budget or both.');
    expect((await call(h, 'api/studio/settings', { body: { budget: 0.01 } })).body).toEqual({ model: 'sonnet', budget: 0.01 });
    const s = await answered(h, '[fake:spend] Go through it all.');
    expect(s.spent).toBeGreaterThanOrEqual(0.01);
    const refused = await call(h, 'api/studio/messages', { body: { text: 'One more?' } });
    expect([refused.status, refused.body.error]).toEqual([409, 'The studio chat has spent its $0.01 budget. Raise its budget at the top of the chat to ask more.']);
    expect((await studioOf(h)).entries.map((e) => e.kind)).toEqual(['you', 'studio']);
    await h.close();
    hubs.length = 0;
    const again = await startHub({ port: 0, token: TOKEN, webDir: null, library, home: first.home, make: fakes().make, tickMs: 10, claudeHome: tempDir('worklings-claude-'), claude: FAKE_DESK });
    hubs.push(again);
    expect((await studioOf(again)).budget).toBe(0.01);
    expect((await call(again, 'api/studio/messages', { body: { text: 'One more?' } })).status).toBe(409);
    // Raised: it takes messages again.
    expect((await call(again, 'api/studio/settings', { body: { budget: 2.5 } })).body).toEqual({ model: 'sonnet', budget: 2.5 });
    expect((await call(again, 'api/studio/messages', { body: { text: 'One more?' } })).status).toBe(202);
  });

  it('answers a message sent right after the model changes, from a new desk on that model', async () => {
    const { hub: h, logFile } = await hub();
    await answered(h, 'Hi there.');
    expect((await call(h, 'api/studio/settings', { body: { model: 'haiku' } })).status).toBe(200);
    const s = await answered(h, 'And again.');
    expect(s.entries.map((e) => e.kind)).toEqual(['you', 'studio', 'you', 'studio']);
    expect(s.state).toBe('idle');
    const models = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry).filter((e) => e.event === 'start').map((e) => e.argv?.[(e.argv?.indexOf('--model') ?? -2) + 1]);
    expect(models).toEqual(['sonnet', 'haiku']);
  });

  it('keeps its lines and model across a restart, and a new conversation clears them', async () => {
    const first = await hub();
    await answered(first.hub, '[fake:list] What runs?');
    await call(first.hub, 'api/studio/settings', { body: { model: 'opus' } });
    await first.hub.close();
    hubs.length = 0;
    const again = await startHub({ port: 0, token: TOKEN, webDir: null, library, home: first.home, make: fakes().make, tickMs: 10, claudeHome: tempDir('worklings-claude-'), claude: FAKE_DESK });
    hubs.push(again);
    const s = await studioOf(again);
    expect(s.model).toBe('opus');
    expect(s.entries.map((e) => e.kind)).toEqual(['you', 'studio']);
    expect(s.entries[1]?.text).toContain('Listed: The companies in the lobby:');
    expect((await call(again, 'api/studio/clear', { body: {} })).status).toBe(200);
    expect((await studioOf(again)).entries).toEqual([]);
  });
});
