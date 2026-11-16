import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_INSTALL_URL } from '../src/doctor.ts';
import { setupRoutes, shellQuote, type SetupOptions, type SetupView, type WatchPlan } from '../src/hub/setup-routes.ts';
import { HOOK_EVENTS } from '../src/server/hooks-config.ts';
import { sendError } from '../src/server/http.ts';
import { tempDir, writeTree } from './library-kit.ts';

const fakeClaude = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))));
});

/** The routes behind a bare server, as the hub's api() calls them, with its error handling. */
async function serveRoutes(o: Partial<SetupOptions> & { clock?: { t: number } } = {}) {
  const clock = o.clock ?? { t: 1_000 };
  const route = setupRoutes({
    env: { ...process.env, FAKE_CLAUDE_AUTH: 'signed-in' }, claude: fakeClaude, places: () => ({ companies: [], home: tempDir('worklings-home-'), own: [] }),
    now: () => clock.t, ...o,
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    route(req, res, url.pathname, url).then(
      (answered) => {
        if (!answered) sendError(res, new Error('No such endpoint.'), 404);
      },
      (error: unknown) => sendError(res, error, (error as { status?: number }).status ?? 500),
    );
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, init);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { call, post, clock, server };
}

const watchQuery = (folder: string, extra = '') => `/api/watch?folder=${encodeURIComponent(folder)}${extra}`;

describe('GET /api/setup', { timeout: 60_000 }, () => {
  it("says Claude Code is ready and git is there, from Claude Code's own status", async () => {
    const { call } = await serveRoutes();
    const { status, body } = await call('/api/setup');
    expect(status).toBe(200);
    const view = body as unknown as SetupView;
    expect(view.claude).toMatchObject({ state: 'ready', version: '2.1.312', account: 'your Claude Max plan', fix: null });
    expect(view.git).toMatchObject({ found: true, fix: null });
    expect(view.checkedAt).toBe(1_000);
  });

  it('says how to sign in, and how to install Claude Code when it is missing', async () => {
    const signedOut = await serveRoutes({ env: { ...process.env, FAKE_CLAUDE_AUTH: 'signed-out' } });
    expect((await signedOut.call('/api/setup')).body.claude).toMatchObject({ state: 'signed-out', fix: 'Run claude once in a terminal and sign in.' });
    const { WORKLINGS_CLAUDE: _w, HEADCOUNT_CLAUDE: _h, ...rest } = process.env;
    const missing = await serveRoutes({ env: { ...rest, PATH: tempDir('worklings-path-'), Path: undefined }, claude: undefined });
    expect((await missing.call('/api/setup')).body.claude).toMatchObject({ state: 'missing', link: CLAUDE_INSTALL_URL });
  });

  it('keeps a check for a while, and checks again when asked to', async () => {
    const { call, clock } = await serveRoutes({ freshMs: 60_000 });
    expect((await call('/api/setup')).body.checkedAt).toBe(1_000);
    clock.t = 30_000;
    expect((await call('/api/setup')).body.checkedAt).toBe(1_000);
    expect((await call('/api/setup?fresh=1')).body.checkedAt).toBe(30_000);
    clock.t = 100_000;
    expect((await call('/api/setup')).body.checkedAt).toBe(100_000);
  });

  it('runs one check for requests that arrive while it runs', async () => {
    const { call } = await serveRoutes();
    const answers = await Promise.all([call('/api/setup?fresh=1'), call('/api/setup?fresh=1'), call('/api/setup')]);
    expect(new Set(answers.map((a) => a.body.checkedAt)).size).toBe(1);
  });
});

describe('the health and stop routes that worklings hub --stop uses', () => {
  it('names the process the hub runs in', async () => {
    const { call } = await serveRoutes({ pid: 4242 });
    expect(await call('/api/health')).toEqual({ status: 200, body: { ok: true, app: 'worklings-hub', pid: 4242 } });
  });

  it('answers first and then closes the hub, so the caller hears it although closing cuts every connection', async () => {
    const holder: { server?: Server } = {};
    let stops = 0;
    const routes = await serveRoutes({
      pid: 4242,
      stop: () => {
        stops += 1;
        holder.server?.closeAllConnections();
      },
    });
    holder.server = routes.server;
    expect(await routes.post('/api/hub/stop', {})).toEqual({ status: 202, body: { stopping: true, pid: 4242 } });
    await vi.waitFor(() => expect(stops).toBe(1));
  });

  it('takes a stop only from this computer, and has no stop route without a way to stop', async () => {
    let stopped = 0;
    const { post } = await serveRoutes({ stop: () => (stopped += 1) });
    expect(await post('/api/hub/stop', {}, { 'x-forwarded-for': '100.101.102.103' })).toMatchObject({ status: 403, body: { code: 'local-only' } });
    expect(stopped).toBe(0);
    const without = await serveRoutes();
    expect((await without.post('/api/hub/stop', {})).status).toBe(404);
  });
});

describe('the commands the setup step offers to copy', () => {
  it('quote a folder so $, backticks, spaces and quotes stay literal in bash and PowerShell', () => {
    expect(shellQuote('/home/me/my project')).toBe("'/home/me/my project'");
    expect(shellQuote('/tmp/$(rm -rf ~)`x`"y"', false)).toBe("'/tmp/$(rm -rf ~)`x`\"y\"'");
    expect(shellQuote("/tmp/it's", false)).toBe(String.raw`'/tmp/it'\''s'`);
    expect(shellQuote(String.raw`C:\Users\me\it's`, true)).toBe(String.raw`'C:\Users\me\it''s'`);
  });
});

describe('the consent step for watching a project', () => {
  const project = () => writeTree(tempDir('worklings-watched-'), { 'package.json': { name: 'plant-pal' }, '.git/': '' });

  it('shows what watching writes, and writes nothing until the person agrees', async () => {
    const root = project();
    const { call, post } = await serveRoutes();
    const plan = await call(watchQuery(root));
    expect(plan.status).toBe(200);
    expect(plan.body as unknown as WatchPlan).toEqual({
      folder: root, file: '.claude/settings.local.json', port: 7421, events: HOOK_EVENTS.length, installed: false, installedPort: null, gitignore: true,
      open: `npx worklings office '${root}'`,
    });
    const refused = await post('/api/watch', { folder: root });
    expect(refused).toMatchObject({ status: 400, body: { code: 'consent' } });
    expect(String(refused.body.error)).toContain("needs the person's OK first");
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
  });

  it('writes the hooks and the .gitignore line once the person agrees', async () => {
    const root = project();
    const { call, post } = await serveRoutes();
    const done = await post('/api/watch', { folder: root, consent: true, port: 7500 });
    expect(done).toMatchObject({ status: 200, body: { installed: true, port: 7500, gitignoreUpdated: true, open: `npx worklings office '${root}' --port 7500` } });
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf8')) as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.claude/settings.local.json\n');
    expect((await call(watchQuery(root, '&port=7500'))).body).toMatchObject({ installed: true, installedPort: 7500, gitignore: false });
    expect((await call(watchQuery(root))).body).toMatchObject({ installed: false, installedPort: 7500 });
  });

  it('refuses folders it must not write to, with the sentence that says why', async () => {
    const { call, post } = await serveRoutes();
    expect(await call(watchQuery(join(tempDir(), 'nope')))).toMatchObject({ status: 400, body: { code: 'missing' } });
    expect(await call('/api/watch?folder=relative%2Fpath')).toMatchObject({ status: 400, body: { code: 'bad-folder' } });
    expect(await post('/api/watch', { folder: project(), consent: true, port: 'soon' })).toMatchObject({ status: 400, body: { code: 'bad-input' } });
    expect(await post('/api/watch', { folder: project(), consent: true, extra: 1 })).toMatchObject({ status: 400, body: { code: 'bad-input' } });
  });

  it("won't read the settings through a .claude folder the project links elsewhere, a folder or a huge file", async () => {
    const { call } = await serveRoutes();
    const linked = project();
    const elsewhere = writeTree(tempDir('worklings-elsewhere-'), { 'settings.local.json': { hooks: {} } });
    symlinkSync(elsewhere, join(linked, '.claude'), 'junction');
    const viaLink = await call(watchQuery(linked));
    expect(viaLink).toMatchObject({ status: 400, body: { code: 'settings' } });
    expect(String(viaLink.body.error)).toContain('symlink or junction');
    const asFolder = writeTree(project(), { '.claude/settings.local.json/': '' });
    expect(await call(watchQuery(asFolder))).toMatchObject({ status: 400, body: { code: 'settings' } });
    const huge = writeTree(project(), { '.claude/settings.local.json': `{"x":"${'a'.repeat(1024 * 1024)}"}` });
    const tooBig = await call(watchQuery(huge));
    expect(tooBig).toMatchObject({ status: 400, body: { code: 'settings' } });
    expect(String(tooBig.body.error)).toContain('1 MB');
  });

  it("won't write through a .claude folder the project links elsewhere", async () => {
    const root = project();
    const elsewhere = tempDir('worklings-elsewhere-');
    symlinkSync(elsewhere, join(root, '.claude'), 'junction');
    const { post } = await serveRoutes();
    const refused = await post('/api/watch', { folder: root, consent: true });
    expect(refused).toMatchObject({ status: 400, body: { code: 'settings' } });
    expect(String(refused.body.error)).toContain('symlink or junction');
    expect(existsSync(join(elsewhere, 'settings.local.json'))).toBe(false);
  });

  it('takes watching only from this computer, never from the tailnet', async () => {
    const root = project();
    const { call, post } = await serveRoutes();
    const forwarded = { 'x-forwarded-for': '100.101.102.103' };
    expect(await call(watchQuery(root), { headers: forwarded })).toMatchObject({ status: 403, body: { code: 'local-only' } });
    expect(await post('/api/watch', { folder: root, consent: true }, forwarded)).toMatchObject({ status: 403, body: { code: 'local-only' } });
  });
});
