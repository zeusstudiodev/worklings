import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { agentKey, leadKey } from '../src/core/office.ts';
import type { AsideOptions } from '../src/server/aside.ts';
import { ClaudeError, type ClaudeResult, type RunClaudeOptions } from '../src/server/claude.ts';
import { fromThisMachine, type RunningServer } from '../src/server/http.ts';
import { isInside, Office, type Snapshot } from '../src/server/office.ts';
import { runOffice } from '../src/server/run.ts';
import { hookPayloads, SESSION, SUBAGENT, transcript } from './fixtures.ts';
import { miniLibrary, tempDir, writeTree } from './library-kit.ts';

const TOKEN = 'test-token-0123456789abcdefghijklmnop';
const library = loadLibrary(miniLibrary());
const running: RunningServer[] = [];
/** WORKLINGS_CLAUDE's name before the rename, which the office still reads. */
const LEGACY_CLAUDE = 'HEADCOUNT_CLAUDE';

/**
 * The shell's environment with no way to the real Claude Code: neither name of the variable that picks it, and an empty
 * folder as the PATH. A question that misses the fake fails as not installed and starts nothing.
 */
function noClaude(): NodeJS.ProcessEnv {
  const shell = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', LEGACY_CLAUDE, 'PATH'].includes(name.toUpperCase()));
  return { ...Object.fromEntries(shell), PATH: tempDir('worklings-no-claude-') };
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function office(options: { root?: string; lan?: boolean; webDir?: string | null; reshape?: (b: unknown) => unknown; mode?: 'live' | 'demo' | 'replay' } = {}) {
  const server = await runOffice({
    root: options.root ?? '/project', name: 'Test', port: 0, lan: options.lan ?? false, token: TOKEN,
    webDir: options.webDir ?? null, library, mode: options.mode ?? 'live', tickMs: 10, aside: { env: noClaude() },
    ...(options.reshape ? { api: { reshape: options.reshape } } : {}),
  });
  running.push(server);
  return server;
}

/** A raw request so tests can set Host and Origin headers, which fetch won't let us forge. */
function raw(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

/** Where installed hooks post: the query only marks which hooks in a settings file are ours. */
const HOOK_PATH = '/hooks?from=worklings';
/** Where hooks installed before the rename post, which the office must keep taking. */
const LEGACY_HOOK_PATH = '/hooks?from=headcount';

const postHook = (port: number, payload: unknown, path = HOOK_PATH) =>
  raw(port, path, { method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` }, body: JSON.stringify(payload) });

async function state(port: number): Promise<Snapshot> {
  return (await fetch(`http://127.0.0.1:${port}/api/state?token=${TOKEN}`)).json() as Promise<Snapshot>;
}

describe('hook intake', () => {
  it('turns a real session into office state', async () => {
    const { port } = await office();
    for (const payload of hookPayloads()) expect((await postHook(port, payload)).status).toBe(200);
    const s = await state(port);
    expect(s.sessions).toHaveLength(1);
    expect(s.agents.map((a) => [a.key, a.status])).toEqual([
      [leadKey(SESSION), 'idle'],
      [agentKey(SESSION, SUBAGENT), 'done'],
    ]);
    expect(s.hooks.lastEventAt).toBeGreaterThan(0);
  });

  it(`still takes hooks installed before the rename, which post to ${LEGACY_HOOK_PATH}`, async () => {
    const { port } = await office();
    for (const payload of hookPayloads()) expect((await postHook(port, payload, LEGACY_HOOK_PATH)).status).toBe(200);
    expect((await state(port)).agents.map((a) => [a.key, a.status])).toEqual([
      [leadKey(SESSION), 'idle'],
      [agentKey(SESSION, SUBAGENT), 'done'],
    ]);
  });

  it('answers Claude Code with an empty 200 so the session never waits on parsing', async () => {
    const { port } = await office();
    const res = await postHook(port, hookPayloads()[0]);
    expect(res).toMatchObject({ status: 200, body: '' });
  });

  it('ignores sessions from other projects', async () => {
    const { port, office: o } = await office({ root: '/elsewhere' });
    await postHook(port, hookPayloads()[1]);
    expect(o.state.agents).toEqual({});
    expect(o.ignoredHooks).toBe(1);
  });

  it('refuses hooks from browsers, foreign hosts and non-JSON bodies', async () => {
    const { port } = await office();
    const body = JSON.stringify(hookPayloads()[0]);
    const json = { 'content-type': 'application/json', host: `127.0.0.1:${port}` };
    expect((await raw(port, '/hooks', { method: 'POST', headers: { ...json, origin: 'https://evil.example' }, body })).status).toBe(403);
    expect((await raw(port, '/hooks', { method: 'POST', headers: { ...json, host: 'evil.example' }, body })).status).toBe(403);
    expect((await raw(port, '/hooks', { method: 'POST', headers: { ...json, 'content-type': 'text/plain' }, body })).status).toBe(415);
    expect((await raw(port, '/hooks', { method: 'POST', headers: json, body: '{nope' })).status).toBe(400);
  });

  it('takes hooks only over connections from this machine, whatever the Host header says', () => {
    for (const address of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) expect(fromThisMachine(address)).toBe(true);
    for (const address of ['192.168.1.20', '::ffff:192.168.1.20', '10.0.0.1', 'fe80::1', '', undefined]) expect(fromThisMachine(address)).toBe(false);
  });

  it('drops hooks without a folder, and every hook during a replay or the demo', async () => {
    const { port, office: o } = await office();
    const noFolder = { ...(hookPayloads()[1] as Record<string, unknown>) };
    delete noFolder.cwd;
    await postHook(port, noFolder);
    expect(Object.keys(o.state.agents)).toEqual([]);
    expect(o.ignoredHooks).toBe(1);
    for (const mode of ['replay', 'demo'] as const) {
      const other = new Office('/project', 'Test', mode);
      expect(other.ingestHook(hookPayloads()[1])).toBe(false);
      expect(Object.keys(other.state.agents)).toEqual([]);
    }
  });
});

describe('browser API', () => {
  it('rejects DNS-rebinding hosts and cross-origin reads', async () => {
    const { port } = await office();
    expect((await raw(port, '/api/state', { headers: { host: `attacker.example:${port}` } })).status).toBe(403);
    expect((await raw(port, '/api/state', { headers: { host: `127.0.0.1:${port}`, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await raw(port, '/api/state', { headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
  });

  it('keeps prompts and costs behind the token, except in the made-up demo', async () => {
    const { port } = await office();
    expect((await fetch(`http://127.0.0.1:${port}/api/state`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/events`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/api/state?token=${TOKEN}`)).status).toBe(200);
    const demo = await office({ mode: 'demo' });
    expect((await fetch(`http://127.0.0.1:${demo.port}/api/state`)).status).toBe(200);
  });

  it('requires the token for every change', async () => {
    let calls = 0;
    const { port } = await office({ reshape: () => ({ ok: true, calls: ++calls }) });
    const headers = { 'content-type': 'application/json', host: `127.0.0.1:${port}` };
    const body = JSON.stringify({ action: 'fire', role: 'x' });
    expect((await raw(port, '/api/reshape', { method: 'POST', headers, body })).status).toBe(401);
    expect((await raw(port, '/api/reshape', { method: 'POST', headers: { ...headers, authorization: 'Bearer wrong' }, body })).status).toBe(401);
    const ok = await raw(port, '/api/reshape', { method: 'POST', headers: { ...headers, authorization: `Bearer ${TOKEN}` }, body });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, calls: 1 });
  });

  it('requires the token for reads too on the local network', async () => {
    const { port } = await office({ lan: true });
    expect((await fetch(`http://127.0.0.1:${port}/api/state`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/api/state?token=${TOKEN}`)).status).toBe(200);
  });

  it('streams snapshots over Server-Sent Events', async () => {
    const { port } = await office();
    const res = await fetch(`http://127.0.0.1:${port}/events?token=${TOKEN}`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let text = '';
    const next = async (pattern: RegExp) => {
      while (!pattern.test(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        text += decoder.decode(value);
      }
    };
    await next(/event: snapshot\ndata: .*\n\n/);
    await postHook(port, hookPayloads()[1]);
    await next(/"status":"working"/);
    await reader.cancel();
  });

  it('serves the web app with a strict CSP and never outside its folder', async () => {
    const web = writeTree(tempDir(), { 'index.html': '<!doctype html><title>Office</title>', 'assets/app.js': 'console.log(1)', '../secret.txt': 'no' });
    const { port } = await office({ webDir: web });
    const home = await fetch(`http://127.0.0.1:${port}/`);
    expect(home.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await home.text()).toContain('<title>Office</title>');
    expect((await fetch(`http://127.0.0.1:${port}/rooms/design`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/assets/app.js`)).headers.get('cache-control')).toContain('immutable');
    expect((await raw(port, '/..%2Fsecret.txt')).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/missing.js`)).status).toBe(404);
  });

  it("lets the office compile the meshopt decoder's WebAssembly, and no other eval", async () => {
    const web = writeTree(tempDir(), { 'index.html': '<!doctype html><title>Office</title>' });
    const { port } = await office({ webDir: web });
    const csp = (await fetch(`http://127.0.0.1:${port}/`)).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('serves the art as glTF, and answers a browser that already has it with a 304', async () => {
    const web = writeTree(tempDir(), { 'index.html': '<!doctype html>', 'art/clips.glb': 'glTF binary bytes' });
    const { port } = await office({ webDir: web });
    const art = await fetch(`http://127.0.0.1:${port}/art/clips.glb`);
    expect([art.status, art.headers.get('content-type'), art.headers.get('cache-control'), await art.text()]).toEqual([200, 'model/gltf-binary', 'no-cache', 'glTF binary bytes']);
    const etag = art.headers.get('etag') ?? '';
    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    const again = await fetch(`http://127.0.0.1:${port}/art/clips.glb`, { headers: { 'if-none-match': etag } });
    expect([again.status, await again.text()]).toEqual([304, '']);
    writeFileSync(join(web, 'art', 'clips.glb'), 'a new build of the clips');
    expect((await fetch(`http://127.0.0.1:${port}/art/clips.glb`, { headers: { 'if-none-match': etag } })).status).toBe(200);
  });
});

describe('live tokens', () => {
  /** A Claude Code config folder with a projects/ folder for the transcripts, as the office expects. */
  const claudeHome = () => {
    const home = tempDir('worklings-claude-');
    const dir = join(home, 'projects', '-project');
    mkdirSync(dir, { recursive: true });
    return { home, dir };
  };

  it('follows the session and subagent transcripts it hears about', async () => {
    const { home, dir } = claudeHome();
    const main = join(dir, `${SESSION}.jsonl`);
    const sub = join(dir, SESSION, 'subagents', `agent-${SUBAGENT}.jsonl`);
    let now = Date.parse('2026-11-04T12:00:00Z');
    const o = new Office('/project', 'Test', 'live', { claudeHome: home, now: () => now });
    const withPaths = (p: Record<string, unknown>) => ({ ...p, transcript_path: main, ...(p.agent_transcript_path ? { agent_transcript_path: sub } : {}) });
    const payloads = hookPayloads().map(withPaths);
    const lines = transcript('main').trimEnd().split('\n');
    writeFileSync(main, `${lines.slice(0, 3).join('\n')}\n`);
    for (const p of payloads.slice(0, 6)) o.ingestHook(p); // up to SubagentStart
    o.poll();
    // The first three lines hold one API message (written twice, once per content block).
    expect(o.state.agents[leadKey(SESSION)]?.usage.output).toBe(384);
    appendFileSync(main, `${lines.slice(3).join('\n')}\n`);
    mkdirSync(dirname(sub), { recursive: true });
    // Claude Code can write a subagent's last message after its SubagentStop hook: hold its lines back for now (one
    // line per content block, all with the same message id).
    const subLines = transcript('subagent').trimEnd().split('\n');
    const lastId = /"id":"(msg_[^"]+)"/.exec(subLines.at(-1) ?? '')?.[1] ?? 'none';
    const cut = subLines.findIndex((l) => l.includes(lastId));
    writeFileSync(sub, `${subLines.slice(0, cut).join('\n')}\n`);
    o.poll();
    expect(o.state.agents[leadKey(SESSION)]?.usage.output).toBe(1073);
    expect(o.state.agents[agentKey(SESSION, SUBAGENT)]?.usage.output).toBeLessThan(299);
    for (const p of payloads.slice(6)) o.ingestHook(p); // through SessionEnd
    o.poll();
    expect(o.following).toHaveLength(2);
    appendFileSync(sub, `${subLines.slice(cut).join('\n')}\n`);
    now += 2000;
    o.poll();
    expect(o.state.agents[agentKey(SESSION, SUBAGENT)]?.usage.output).toBe(299);
    // Once the grace period is over and the files are read to the end, the tails rest.
    now += 10_000;
    o.poll();
    expect(o.following).toEqual([]);
    // `claude --resume` writes on in the same file: picking the session up again must not count it twice.
    o.ingestHook({ ...payloads[1], hook_event_name: 'UserPromptSubmit', prompt: 'One more thing' });
    o.poll();
    expect(o.following).toEqual([main]);
    expect(o.state.agents[leadKey(SESSION)]?.usage.output).toBe(1073);
    expect(o.state.agents[agentKey(SESSION, SUBAGENT)]?.usage.output).toBe(299);
  });

  it('reads transcripts only from Claude Code\'s projects folder', () => {
    const { home } = claudeHome();
    const elsewhere = writeTree(tempDir(), { 'fake.jsonl': transcript('main') });
    const o = new Office('/project', 'Test', 'live', { claudeHome: home });
    o.ingestHook({ ...hookPayloads()[1], transcript_path: join(elsewhere, 'fake.jsonl') });
    o.ingestHook({ ...hookPayloads()[1], transcript_path: join(home, 'projects', '..', '..', 'fake.jsonl') });
    o.poll();
    expect(o.following).toEqual([]);
    expect(o.state.agents[leadKey(SESSION)]?.usage.output ?? 0).toBe(0);
  });

  it('tells the browsers when people go quiet, and keeps the clock ticking while bubbles are timed', () => {
    let now = 1_000_000;
    const o = new Office(tempDir(), 'Test', 'live', { now: () => now });
    o.loadStudio();
    const snapshots: Snapshot[] = [];
    o.subscribe((s) => snapshots.push(s));
    o.ingest({ kind: 'subagent-start', at: now, sessionId: 's', agentId: 'a1', agentType: 'Explore', cwd: '/project' });
    o.flush();
    const count = snapshots.length;
    now += 16 * 60_000;
    o.poll();
    o.flush();
    expect(snapshots.length).toBe(count + 1);
    expect(snapshots.at(-1)?.agents[0]?.status).toBe('done');
    // A project without studio files doesn't reload (and resend) its studio on every poll.
    expect(o.loadStudio()).toBe(false);
    const stoppedAt = now;
    o.ingest({ kind: 'subagent-stop', at: now, sessionId: 's', agentId: 'a2', agentType: 'Explore' });
    o.flush();
    const before = snapshots.length;
    for (const step of [1000, 1000, 30_000, 1000]) {
      now += step;
      o.poll();
      o.flush();
    }
    // Snapshots kept coming while the 20-second lobby window was open, then stopped once it had closed.
    expect(snapshots.slice(before).map((s) => s.serverTime - stoppedAt)).toEqual([1000, 2000]);
  });

  it.each(['live', 'demo'] as const)('keeps the clock ticking through the meeting where the lead briefs a new subagent (%s)', (mode) => {
    let now = 5_000_000;
    const o = new Office(tempDir(), 'Test', mode, { now: () => now });
    o.loadStudio();
    const snapshots: Snapshot[] = [];
    o.subscribe((s) => snapshots.push(s));
    o.ingest({ kind: 'subagent-start', at: now, sessionId: 's', agentId: 'a1', agentType: 'Explore', cwd: '/project' });
    o.flush();
    const startedAt = now;
    const before = snapshots.length;
    for (let i = 0; i < 10; i++) {
      now += 1000;
      o.poll();
      o.flush();
    }
    // A snapshot a second while the meeting (6.5 s, and 1.5 s to spare) can run, then none until something happens.
    expect(snapshots.slice(before).map((s) => s.serverTime - startedAt)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
  });

  it('takes exact cost from OpenTelemetry logs', async () => {
    const { port, office: o } = await office();
    // Telemetry comes from every session in the shell: only a session the hooks placed in this project counts.
    await postHook(port, { ...hookPayloads()[1], session_id: 's1' });
    const payload = {
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
        scopeLogs: [{ logRecords: [{
          timeUnixNano: '1762250000000000000',
          body: { stringValue: 'claude_code.api_request' },
          attributes: [
            { key: 'event.name', value: { stringValue: 'api_request' } },
            { key: 'session.id', value: { stringValue: 's1' } },
            { key: 'agent_id', value: { stringValue: 'a1' } },
            { key: 'model', value: { stringValue: 'claude-opus-5-5' } },
            { key: 'cost_usd', value: { doubleValue: 0.042 } },
          ],
        }] }],
      }],
    };
    const res = await raw(port, '/otel/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    expect(o.state.agents[agentKey('s1', 'a1')]?.costReported).toBeCloseTo(0.042, 9);
    const elsewhere = JSON.stringify(payload).replace('"s1"', '"s-other"');
    await raw(port, '/otel/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` }, body: elsewhere });
    expect(o.state.sessions['s-other']).toBeUndefined();
  });
});

describe('questions and catch-ups over HTTP', () => {
  const ENDPOINTS: [string, string][] = [
    ['/api/ask', JSON.stringify({ agentKey: leadKey(SESSION), question: 'What are you working on?' })],
    ['/api/catch-up', '{}'],
    ['/api/aside/cancel', JSON.stringify({ id: 'some-call' })],
  ];

  async function asking(options: { mode?: 'live' | 'demo' | 'replay'; lan?: boolean; aside?: AsideOptions } = {}) {
    const server = await runOffice({
      root: '/project', name: 'Test', port: 0, lan: options.lan ?? false, token: TOKEN, webDir: null, library, mode: options.mode ?? 'live', tickMs: 10,
      aside: { workRoot: tempDir('worklings-work-'), env: noClaude(), ...options.aside },
    });
    running.push(server);
    return server;
  }

  const post = (port: number, path: string, body: string, headers: Record<string, string> = {}) =>
    raw(port, path, { method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}`, authorization: `Bearer ${TOKEN}`, ...headers }, body });

  /** A runner that never answers until it is cancelled, so a call stays in flight as long as a test needs. */
  function hanging() {
    const calls: RunClaudeOptions[] = [];
    const run = (o: RunClaudeOptions) => {
      calls.push(o);
      return new Promise<ClaudeResult>((_resolve, reject) => {
        o.signal?.addEventListener('abort', () => reject(new ClaudeError('cancelled', 'Cancelled before Claude Code answered.')), { once: true });
      });
    };
    return { calls, run };
  }

  it('takes questions and catch-ups only with the token, in every mode, the demo included', async () => {
    for (const mode of ['live', 'demo', 'replay'] as const) {
      const { port } = await asking({ mode });
      for (const [path, body] of ENDPOINTS) {
        expect((await raw(port, path, { method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` }, body })).status).toBe(401);
        expect((await post(port, path, body, { authorization: 'Bearer wrong' })).status).toBe(401);
      }
    }
  });

  it('refuses cross-origin requests, the wrong content type, and oversized or malformed bodies', async () => {
    const { port } = await asking();
    for (const [path, body] of ENDPOINTS) {
      expect((await post(port, path, body, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await post(port, path, body, { 'content-type': 'text/plain' })).status).toBe(415);
      expect((await post(port, path, '{nope')).status).toBe(400);
    }
    expect((await post(port, '/api/ask', JSON.stringify({ agentKey: leadKey(SESSION), question: 'x'.repeat(4_100) }))).status).toBe(413);
    expect((await post(port, '/api/catch-up', JSON.stringify({ pad: 'x'.repeat(1_100) }))).status).toBe(413);
    expect((await post(port, '/api/aside/cancel', JSON.stringify({ id: 'x'.repeat(1_100) }))).status).toBe(413);
  });

  it('starts a question, refuses a second call while it runs, and cancels it', async () => {
    const runner = hanging();
    const { port } = await asking({ aside: { run: runner.run } });
    for (const payload of hookPayloads()) await postHook(port, payload);
    const unknown = await post(port, '/api/ask', JSON.stringify({ agentKey: 'nobody:lead', question: 'Hi?' }));
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toMatchObject({ code: 'unknown-agent' });
    const empty = await post(port, '/api/ask', JSON.stringify({ agentKey: leadKey(SESSION), question: '  ' }));
    expect([empty.status, JSON.parse(empty.body)]).toEqual([400, { error: 'Type a question to ask.', code: 'bad-input' }]);

    const asked = await post(port, '/api/ask', ENDPOINTS[0]?.[1] ?? '');
    expect(asked.status).toBe(202);
    const { id } = JSON.parse(asked.body) as { id: string };
    expect((await state(port)).aside.running).toMatchObject({ id, kind: 'ask', agentKey: leadKey(SESSION) });
    const busy = await post(port, '/api/catch-up', '{}');
    expect(busy.status).toBe(409);
    expect(JSON.parse(busy.body)).toMatchObject({ code: 'busy' });

    const cancelled = await post(port, '/api/aside/cancel', JSON.stringify({ id }));
    expect([cancelled.status, JSON.parse(cancelled.body)]).toEqual([200, { cancelled: true }]);
    await vi.waitFor(async () => expect((await state(port)).aside.answers).toMatchObject([{ id, failure: { code: 'cancelled' } }]));
    expect(runner.calls).toHaveLength(1);
  });

  it('says how long to wait once the office has made its calls for the minute', async () => {
    const at = Date.now();
    const result: ClaudeResult = { text: 'On it.', reportedCostUsd: 0.001, usage: { input: 1_000, output: 20, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, model: 'claude-haiku-5-5', sessionId: null, durationMs: 5 };
    const server = await asking({ aside: { run: () => Promise.resolve(result), now: () => at } });
    for (const payload of hookPayloads()) await postHook(server.port, payload);
    for (let i = 0; i < 6; i++) {
      expect((await post(server.port, '/api/ask', ENDPOINTS[0]?.[1] ?? '')).status).toBe(202);
      await server.aside.settled();
    }
    const limited = await post(server.port, '/api/ask', ENDPOINTS[0]?.[1] ?? '');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(JSON.parse(limited.body)).toEqual({ error: 'The office takes a few calls a minute. Try again in 60 seconds.', code: 'rate-limited', retryAfter: 60 });
  });

  it("answers through Claude Code (a fake one) and counts the office's spend in the snapshot", async () => {
    const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
    const server = await asking({ aside: { env: { ...noClaude(), WORKLINGS_CLAUDE: fake, FAKE_CLAUDE_MODE: 'ok' } } });
    for (const payload of hookPayloads()) await postHook(server.port, payload);
    expect((await post(server.port, '/api/ask', ENDPOINTS[0]?.[1] ?? '')).status).toBe(202);
    await server.aside.settled();
    const s = await state(server.port);
    expect(s.aside.answers).toMatchObject([{ source: 'fork', failure: null, text: expect.stringContaining('This is the fake Claude Code') }]);
    expect(s.aside.spend.questions).toBe(1);
    expect(s.totals.cost).toBeCloseTo(s.aside.spend.cost, 12);
  });

  it('reads only JSON bodies, matching the media type exactly', async () => {
    const { port } = await asking();
    // An empty office has nothing new, so an accepted catch-up answers 200 at once.
    for (const type of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON;charset="UTF-8"']) {
      expect((await post(port, '/api/catch-up', '{}', { 'content-type': type })).status).toBe(200);
    }
    for (const type of ['application/json-patch+json', 'text/plain; application/json', 'application/jsonx', 'application/json; charset=latin1', 'application/json; boundary=x', '']) {
      expect((await post(port, '/api/catch-up', '{}', { 'content-type': type })).status).toBe(415);
    }
  });

  // Connecting to this machine's own network address reaches the office the way another computer would.
  const lanAddress = Object.values(networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;

  it.skipIf(!lanAddress)('takes questions and catch-ups only from this machine when the office is on the local network', async () => {
    const { port } = await asking({ lan: true });
    const from = (host: string, method: string, path: string, body?: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const headers: Record<string, string> = { host: `${host}:${port}`, authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) };
        const req = request({ host, port, path, method, headers }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        });
        req.on('error', reject);
        req.end(body);
      });
    const network = lanAddress ?? '';
    for (const [path, body] of ENDPOINTS) {
      const refused = await from(network, 'POST', path, body);
      expect([refused.status, JSON.parse(refused.body)]).toEqual([403, { error: 'Questions and catch-ups work only on the computer running the office: open it there at localhost.', code: 'local-only' }]);
      // From this machine they pass that check (the office has nobody to ask, so a question gets as far as 404).
      expect((await from('127.0.0.1', 'POST', path, body)).status).not.toBe(403);
    }
    // Reading the office from the network, with the token, is still allowed.
    expect((await from(network, 'GET', '/api/state')).status).toBe(200);
  });

  it('stops a running call when the office closes', async () => {
    const runner = hanging();
    const server = await asking({ aside: { run: runner.run } });
    for (const payload of hookPayloads()) await postHook(server.port, payload);
    expect((await post(server.port, '/api/ask', ENDPOINTS[0]?.[1] ?? '')).status).toBe(202);
    await server.close();
    expect(runner.calls[0]?.signal?.aborted).toBe(true);
  });
});

describe('isInside', () => {
  it('compares paths across slash styles', () => {
    expect(isInside('/project', '/project/sub')).toBe(true);
    expect(isInside('/project', '/project')).toBe(true);
    expect(isInside('/project', '/projects')).toBe(false);
    expect(isInside('C:\\Dev\\app', 'C:/Dev/app/src')).toBe(true);
  });
});

describe("a company's desks in the office", () => {
  const prompt = (sessionId: string, cwd: string, text: string) => ({ session_id: sessionId, cwd, hook_event_name: 'UserPromptSubmit', prompt: text });

  it("takes a desk's hooks from a worktree outside the folder, but never for another person's session", () => {
    const root = tempDir();
    const o = new Office(root, 'Test', 'live');
    expect(o.ingestHook(prompt('desk', join(root, '..', 'worktree'), 'From the CEO: start on the menu'))).toBe(false);
    expect(o.ingestDeskHook(prompt('desk', join(root, '..', 'worktree'), 'From the CEO: start on the menu'), 'ux-designer')).toBe(true);
    expect(o.state.agents[leadKey('desk')]).toMatchObject({ roleId: null, agentType: 'ux-designer', name: 'UX designer' });
    expect(o.ingestDeskHook(prompt('desk', root, 'From the CEO: and the footer'), 'qa-engineer')).toBe(false);
    expect(o.state.assigned.desk).toBe('ux-designer');
    for (const mode of ['replay', 'demo'] as const) expect(new Office(root, 'Test', mode).ingestDeskHook(prompt('desk', root, 'Hello there'), 'ux-designer')).toBe(false);
  });

  it("names a person's figure by their most recent desk session, once the office has seen one", () => {
    let now = 1_000;
    const o = new Office(tempDir(), 'Test', 'live', { now: () => now });
    expect(o.agentKeyOf('ux-designer')).toBeNull();
    o.assignSession('old', 'ux-designer');
    expect(o.agentKeyOf('ux-designer')).toBeNull();
    o.ingestDeskHook(prompt('old', o.root, 'From the CEO: first try at it'), 'ux-designer');
    now += 1_000;
    o.ingestDeskHook(prompt('new', o.root, 'From the CEO: second try at it'), 'ux-designer');
    expect(o.agentKeyOf('ux-designer')).toBe(leadKey('new'));
    expect(o.agentKeyOf('qa-engineer')).toBeNull();
  });

  it('says once that something changed, for the hub that sends its own snapshots', () => {
    const o = new Office(tempDir(), 'Test', 'live');
    expect(o.takeChanges()).toBe(true);
    expect(o.takeChanges()).toBe(false);
    expect(o.assignSession('desk', 'ux-designer')).toBe(true);
    expect(o.takeChanges()).toBe(true);
    expect(o.assignSession('desk', 'ux-designer')).toBe(false);
    expect(o.takeChanges()).toBe(false);
  });
});
