import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { type CompanySummary, type LobbyView, type Message, type MessagePage, OrgRefusal } from '../src/core/company.ts';
import { NOT_KEPT } from '../src/core/message-pages.ts';
import { agentCost } from '../src/core/office.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import type { Ack } from '../src/core/steering.ts';
import { findGit, shortFolder } from '../src/hub/folders.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import { classifyPermission, stopsByPid } from '../src/runtime/approvals.ts';
import { transcriptDir } from '../src/server/replay.ts';
import { type FakeCompany, type Fakes, fakes, TOKEN } from './hub-kit.ts';
import { miniLibrary, tempDir, writeTree } from './library-kit.ts';

const library = loadLibrary(miniLibrary());
const hubs: RunningHub[] = [];
const permissionPayload = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/claude-2.1.312/mcp/permission-request.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
const DESK = '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const VISITOR = 'b0581371-e091-4b14-9a83-550be0bb1ac8';
const STUDIO = ['version: 1', 'name: Plant Pal', 'domain: custom', 'rigor: lean', 'departments:', '  - id: design', '    name: Design', '    style: design',
  'roles:', '  - id: ux-designer', '    department: design', '    title: UX designer', ''].join('\n');

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.close();
});

/** Git that reads only `config`, never the person's own: the stakeholder's name is a test's choice. */
function gitEnv(config = ''): NodeJS.ProcessEnv {
  const file = join(tempDir('worklings-git-'), 'gitconfig');
  writeFileSync(file, config);
  const shell = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE'].includes(name.toUpperCase()));
  return { ...Object.fromEntries(shell), GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1' };
}

interface TestHub extends RunningHub {
  f: Fakes;
  home: string;
  claude: string;
}

async function hub(o: { home?: string; f?: Fakes; settings?: object; webDir?: string; tailnet?: boolean; approvalWaitMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<TestHub> {
  const home = o.home ?? tempDir('worklings-hubhome-');
  if (o.settings) writeTree(home, { '.worklings/settings.json': o.settings });
  const f = o.f ?? fakes();
  const claude = tempDir('worklings-claude-');
  const running = await startHub({
    port: 0, token: TOKEN, webDir: o.webDir ?? null, library, home, make: f.make, tickMs: 10, claudeHome: claude, env: o.env ?? gitEnv(),
    aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') }, ...(o.tailnet ? { tailnet: true, tailnetPort: 0 } : {}),
    ...(o.approvalWaitMs === undefined ? {} : { approvalWaitMs: o.approvalWaitMs }),
  });
  hubs.push(running);
  return Object.assign(running, { f, home, claude });
}

/** A raw request, so tests can set Host, Origin and forwarding headers that fetch won't let us forge. */
function raw(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
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

const local = (port: number) => ({ host: `127.0.0.1:${port}` });
const get = (port: number, path: string, headers: Record<string, string> = {}) => raw(port, path, { headers: { ...local(port), authorization: `Bearer ${TOKEN}`, ...headers } });
const post = (port: number, path: string, body: unknown, headers: Record<string, string> = {}) =>
  raw(port, path, { method: 'POST', headers: { ...local(port), authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const json = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;
/** A hook as Claude Code posts it to the office: from this machine, without the token. */
const sendHook = (port: number, payload: object) =>
  raw(port, '/hooks?from=worklings', { method: 'POST', headers: { ...local(port), 'content-type': 'application/json' }, body: JSON.stringify(payload) });
/** A transcript line for one API answer, in tokens of a model the price table knows. */
const answered = (messageId: string, input: number, output: number) =>
  `${JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: messageId, model: 'claude-sonnet-4-5', role: 'assistant', usage: { input_tokens: input, output_tokens: output } } })}\n`;

async function lobby(port: number): Promise<LobbyView> {
  return JSON.parse((await get(port, '/api/lobby')).body) as LobbyView;
}

async function state(port: number, id: string): Promise<Snapshot> {
  return JSON.parse((await get(port, `/api/c/${id}/state`)).body) as Snapshot;
}

/** A hub with one company in a new folder. */
async function withCompany(o: Parameters<typeof hub>[0] & { name?: string; files?: Record<string, string> } = {}) {
  const h = await hub(o);
  const parent = realpathSync.native(tempDir('worklings-projects-'));
  const root = join(parent, o.name ?? 'plant-pal');
  if (o.files) writeTree(root, o.files);
  const created = await post(h.port, '/api/companies', { folder: root, prompt: 'A plant care app with watering streaks' });
  expect(created.status).toBe(201);
  const id = String(json(created).id);
  const company = h.f.byRoot(root) as FakeCompany;
  return { h, id, root, company };
}

/** Follows a stream, returning its events one by one. */
async function follow(port: number, path: string) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${path}?token=${TOKEN}`, { signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async <T>(event: string, test: (data: T) => boolean = () => true): Promise<T> => {
    for (;;) {
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (name === event && data) {
          const value = JSON.parse(data) as T;
          if (test(value)) return value;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('the stream ended');
      buffer += decoder.decode(value);
    }
  };
  return { status: res.status, type: res.headers.get('content-type'), next, close: () => controller.abort() };
}

describe('companies over HTTP', () => {
  it('creates a company in a new folder and lists it in the lobby and its stream', async () => {
    const h = await hub({ settings: { stakeholder: 'Robin' } });
    const parent = realpathSync.native(tempDir('worklings-projects-'));
    const root = join(parent, 'plant-pal');
    const stream = await follow(h.port, '/events/lobby');
    expect(await stream.next<LobbyView>('lobby')).toMatchObject({ companies: [], hub: { maxDesks: 8, working: 0 } });
    const created = await post(h.port, '/api/companies', { folder: root, prompt: '  A plant care app with watering streaks  ' });
    expect([created.status, json(created)]).toEqual([201, { id: 'plant-pal', reopened: false }]);
    expect(existsSync(root)).toBe(true);
    expect(h.f.created).toEqual([{ id: 'plant-pal', root, prompt: 'A plant care app with watering streaks', stakeholder: 'Robin' }]);
    expect((await lobby(h.port)).companies.map((c) => [c.id, c.root])).toEqual([['plant-pal', root]]);
    expect((await stream.next<LobbyView>('lobby', (l) => l.companies.length > 0)).companies[0]).toMatchObject({ id: 'plant-pal', name: 'plant-pal' });
    stream.close();
    const registry = JSON.parse(readFileSync(join(h.home, '.worklings', 'companies.json'), 'utf8')) as { companies: unknown };
    expect(registry.companies).toEqual([{ id: 'plant-pal', root }]);
  });

  it('gives each company its switchboard, wired to the hub, its desk tokens and the shared desk cap', async () => {
    const { h, id, root, company } = await withCompany();
    const board = h.f.switchboards[0];
    expect(board).toMatchObject({ companyId: 'plant-pal', root, maxDesks: 8, idleMs: 300_000, hub: { url: h.url } });
    expect(board?.gate?.max).toBe(8);
    expect(board?.rules?.()).toEqual(['Bash(npm test)']);
    company.state.settings.alwaysAllow = ['Bash(npm test)', 'Bash(git push origin:*)'];
    expect(board?.rules?.()).toEqual(['Bash(npm test)', 'Bash(git push origin:*)']);
    expect(id).toBe('plant-pal');
  });

  it("names a new company after its folder, with a number when the lobby already has that name", async () => {
    const { h } = await withCompany();
    const again = join(realpathSync.native(tempDir('worklings-projects-')), 'plant-pal');
    expect(json(await post(h.port, '/api/companies', { folder: again, prompt: 'Plant care, take two' }))).toEqual({ id: 'plant-pal-2', reopened: false });
    const odd = join(realpathSync.native(tempDir('worklings-projects-')), 'Café Lumen!');
    expect(json(await post(h.port, '/api/companies', { folder: odd, prompt: 'A café site' }))).toEqual({ id: 'cafe-lumen', reopened: false });
    const none = join(realpathSync.native(tempDir('worklings-projects-')), '東京');
    expect(json(await post(h.port, '/api/companies', { folder: none, prompt: 'A Tokyo guide' }))).toEqual({ id: 'company', reopened: false });
    expect(h.f.switchboards.map((s) => s.companyId)).toEqual(['plant-pal', 'plant-pal-2', 'cafe-lumen', 'company']);
  });

  it("never gives a company the demo's id, whatever its folder's case or accents", async () => {
    const { h } = await withCompany();
    const ids: string[] = [];
    for (const name of ['demo', 'Demo', 'démo']) {
      const folder = join(realpathSync.native(tempDir('worklings-projects-')), name);
      ids.push((json(await post(h.port, '/api/companies', { folder, prompt: 'A site' })) as { id: string }).id);
    }
    expect(ids).toEqual(['demo-2', 'demo-3', 'demo-4']);
  });

  it("names the stakeholder from the settings, else the first word of git's user.name, else nobody", async () => {
    const fromGit = await withCompany({ env: gitEnv('[user]\n\tname = Grace Hopper\n') });
    expect(fromGit.h.f.created[0]?.stakeholder).toBe('Grace');
    const nobody = await withCompany();
    expect(nobody.h.f.created[0]?.stakeholder).toBe('');
    const saved = await withCompany({ settings: { stakeholder: 'Ada' }, env: gitEnv('[user]\n\tname = Grace Hopper\n') });
    expect(saved.h.f.created[0]?.stakeholder).toBe('Ada');
  });

  it("needs a prompt of up to 64,000 characters for a new company, and a folder of the person's own", async () => {
    const h = await hub();
    const folder = join(realpathSync.native(tempDir()), 'shop');
    expect([(await post(h.port, '/api/companies', { folder })).status, json(await post(h.port, '/api/companies', { folder, prompt: ' ' })).error]).toEqual([400, 'Say what to build.']);
    expect(json(await post(h.port, '/api/companies', { folder, prompt: 'x'.repeat(64_001) })).error).toBe('Keep the first prompt to 64,000 characters.');
    expect(json(await post(h.port, '/api/companies', { folder: 'shop', prompt: 'A shop' })).error).toMatch(/^Give the folder's full path/);
    expect((await post(h.port, '/api/companies', { folder, prompt: 'A shop', extra: 1 })).status).toBe(400);
    expect(h.f.created).toEqual([]);
    expect(existsSync(folder)).toBe(false);
  });

  it("refuses a folder inside or around another company's, by its name", async () => {
    const { h, root } = await withCompany();
    const inside = await post(h.port, '/api/companies', { folder: join(root, 'web'), prompt: 'Another one' });
    expect([inside.status, json(inside)]).toEqual([409, { error: "That's inside plant-pal's folder. Pick another.", code: 'inside' }]);
    expect((await post(h.port, '/api/companies', { folder: root, prompt: 'Again' })).status).toBe(409);
  });

  it('reopens a folder that already has a company, with no prompt, and refuses a copy of one that runs without opening it', async () => {
    const h = await hub();
    const root = realpathSync.native(writeTree(tempDir(), { '.worklings/events.jsonl': `${JSON.stringify({ id: 'cafe-lumen', name: 'Café Lumen', prompt: 'A café' })}\n` }));
    const reopened = await post(h.port, '/api/companies', { folder: root });
    expect([reopened.status, json(reopened)]).toEqual([200, { id: 'cafe-lumen', reopened: true }]);
    expect(h.f.opened).toEqual([root]);
    expect(h.f.switchboards.map((s) => s.companyId)).toEqual(['cafe-lumen']);
    const copy = realpathSync.native(tempDir());
    cpSync(join(root, '.worklings'), join(copy, '.worklings'), { recursive: true });
    const refused = await post(h.port, '/api/companies', { folder: copy });
    expect([refused.status, json(refused).code]).toEqual([409, 'copy']);
    expect(String(json(refused).error)).toBe(`This folder holds a copy of Café Lumen, which runs from ${root}. Delete the copy's .worklings folder to start a new company there.`);
    expect(h.f.opened).toEqual([root]);
    expect((await lobby(h.port)).companies.map((c) => c.id)).toEqual(['cafe-lumen']);
  });

  it('runs two companies at once, each with its own snapshot', async () => {
    const { h, id: a, company: plantPal } = await withCompany();
    const root = join(realpathSync.native(tempDir('worklings-projects-')), 'cafe-lumen');
    const b = String(json(await post(h.port, '/api/companies', { folder: root, prompt: 'A café site with pickup orders' })).id);
    const one = await follow(h.port, `/events/c/${a}`);
    const two = await follow(h.port, `/events/c/${b}`);
    expect(one.type).toBe('text/event-stream');
    expect((await one.next<Snapshot>('snapshot')).company).toMatchObject({ id: 'plant-pal', phase: 'founding' });
    expect((await two.next<Snapshot>('snapshot')).company).toMatchObject({ id: 'cafe-lumen' });
    plantPal.state.phase = 'proposed';
    plantPal.emit();
    expect((await one.next<Snapshot>('snapshot', (s) => s.company?.phase === 'proposed')).project.name).toBe('plant-pal');
    expect((await state(h.port, b)).company).toMatchObject({ id: 'cafe-lumen', phase: 'founding' });
    expect((await lobby(h.port)).companies.map((c) => c.id)).toEqual(['plant-pal', 'cafe-lumen']);
    one.close();
    two.close();
  });

  it('reopens every company in the registry when a hub starts again on the same home', async () => {
    const home = tempDir('worklings-hubhome-');
    const { h, root } = await withCompany({ home });
    const second = join(realpathSync.native(tempDir('worklings-projects-')), 'cafe-lumen');
    await post(h.port, '/api/companies', { folder: second, prompt: 'A café site' });
    await h.close();
    hubs.splice(hubs.indexOf(h), 1);
    expect(h.f.companies.every((c) => c.closed)).toBe(true);
    const again = await hub({ home });
    expect(again.f.opened).toEqual([root, second]);
    expect((await lobby(again.port)).companies.map((c) => c.id)).toEqual(['plant-pal', 'cafe-lumen']);
    expect(again.f.switchboards.map((s) => s.companyId)).toEqual(['plant-pal', 'cafe-lumen']);
  });

  it('removes a company from the lobby, closing it, and reopens it when its folder is added again', async () => {
    const { h, id, root, company } = await withCompany();
    const removed = await raw(h.port, `/api/companies/${id}`, { method: 'DELETE', headers: { ...local(h.port), authorization: `Bearer ${TOKEN}` } });
    expect([removed.status, json(removed)]).toEqual([200, { id, removed: true }]);
    expect(company.closed).toBe(true);
    expect((await lobby(h.port)).companies).toEqual([]);
    expect(existsSync(join(root, '.worklings', 'events.jsonl'))).toBe(true);
    expect(json(await get(h.port, `/api/c/${id}/state`))).toEqual({ error: "That company isn't in the lobby any more.", code: 'gone' });
    expect(json(await post(h.port, '/api/companies', { folder: root }))).toEqual({ id, reopened: true });
  });

  it("says a removed company's folder isn't there when Undo can't put it back, not that it needs a prompt", async () => {
    const { h, id, root } = await withCompany();
    const remove = () => raw(h.port, `/api/companies/${id}`, { method: 'DELETE', headers: { ...local(h.port), authorization: `Bearer ${TOKEN}` } });
    expect((await remove()).status).toBe(200);
    const moved = join(dirname(root), 'plant-pal-moved');
    renameSync(root, moved);
    const undo = await post(h.port, '/api/companies', { folder: root });
    expect([undo.status, json(undo).code]).toEqual([400, 'missing']);
    // The lobby shows the sentence as it comes, under a notice that cuts paths the same way.
    expect(json(undo).error).toBe(`Its folder isn't at ${shortFolder(root)} any more. If it moved, add it from where it is now.`);
    expect(json(undo).error).toMatch(/…[\\/]plant-pal any more\./);
    expect(existsSync(root)).toBe(false);
    // Its parent gone too: still the folder that isn't there, not advice to make one.
    const deeper = join(dirname(root), 'gone', 'plant-pal');
    expect(json(await post(h.port, '/api/companies', { folder: deeper })).error).toBe(`Its folder isn't at ${shortFolder(deeper)} any more. If it moved, add it from where it is now.`);
    // A folder that is there but no longer holds the company.
    const empty = realpathSync.native(tempDir('worklings-projects-'));
    expect(json(await post(h.port, '/api/companies', { folder: empty }))).toEqual({ error: `No company works in ${shortFolder(empty)} any more: its .worklings folder is gone.`, code: 'no-company' });
    expect(h.f.created).toHaveLength(1);
    // What the sentence says to do: added from where it is now, it is back.
    expect(json(await post(h.port, '/api/companies', { folder: moved }))).toEqual({ id, reopened: true });
  });

  it("shows a company that can't open with its problem, until it is removed", async () => {
    const home = tempDir('worklings-hubhome-');
    const gone = join(tempDir(), 'plant-pal');
    writeTree(home, { '.worklings/companies.json': { companies: [{ id: 'plant-pal', root: gone }] } });
    const h = await hub({ home });
    expect((await lobby(h.port)).companies).toMatchObject([{ id: 'plant-pal', problem: `Its folder isn't at ${gone} any more. Put it back, or remove the company from the lobby.` }]);
    expect((await get(h.port, '/api/c/plant-pal/state')).status).toBe(409);
    expect((await raw(h.port, '/api/companies/plant-pal', { method: 'DELETE', headers: { ...local(h.port), authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await lobby(h.port)).companies).toEqual([]);
  });

  it('refuses to start while another hub runs for the same companies', async () => {
    const home = tempDir('worklings-hubhome-');
    writeTree(home, { '.worklings/hub.lock': { pid: process.ppid, port: 7999 } });
    await expect(hub({ home })).rejects.toThrow(`Another Worklings hub is running (process ${process.ppid}, port 7999)`);
  });

  it('refuses a company that a hub started from another home runs, naming that hub, and takes it once that hub is gone', async () => {
    const root = realpathSync.native(writeTree(tempDir(), { '.worklings/events.jsonl': `${JSON.stringify({ id: 'cafe-lumen', name: 'Café Lumen', prompt: 'A café' })}\n` }));
    // That hub's ~/.worklings is another folder, so only the company's own lock says it runs there.
    writeTree(root, { '.worklings/hub.lock': { pid: process.ppid, port: 7999, root } });
    const h = await hub();
    const refused = await post(h.port, '/api/companies', { folder: root });
    expect([refused.status, json(refused)]).toEqual([
      409,
      { error: `Another Worklings hub runs this company (process ${process.ppid}, port 7999). Open it at http://127.0.0.1:7999/, or stop that hub and add the folder here again.`, code: 'other-hub' },
    ]);
    expect(h.f.opened).toEqual([]);
    expect((await lobby(h.port)).companies).toEqual([]);
    // Its process is gone, as after a crash: the lock is taken over, and goes again when this hub closes.
    writeTree(root, { '.worklings/hub.lock': { pid: 2 ** 30, port: 7999, root } });
    expect(json(await post(h.port, '/api/companies', { folder: root }))).toEqual({ id: 'cafe-lumen', reopened: true });
    expect(JSON.parse(readFileSync(join(root, '.worklings', 'hub.lock'), 'utf8'))).toEqual({ pid: process.pid, port: h.port, root });
    await h.close();
    expect(existsSync(join(root, '.worklings', 'hub.lock'))).toBe(false);
  });

  it("shows a registered company that another hub runs as one that can't run here, with that hub's address", async () => {
    const home = tempDir('worklings-hubhome-');
    const root = realpathSync.native(writeTree(tempDir(), { '.worklings/events.jsonl': `${JSON.stringify({ id: 'cafe-lumen', name: 'Café Lumen', prompt: 'A café' })}\n` }));
    writeTree(root, { '.worklings/hub.lock': { pid: process.ppid, port: 7999, root } });
    writeTree(home, { '.worklings/companies.json': { companies: [{ id: 'cafe-lumen', root }] } });
    const h = await hub({ home });
    expect(h.f.opened).toEqual([]);
    expect((await lobby(h.port)).companies).toMatchObject([
      { id: 'cafe-lumen', problem: `Another Worklings hub runs this company (process ${process.ppid}, port 7999). Open it at http://127.0.0.1:7999/, or stop that hub and add the folder here again.` },
    ]);
  });

  it("takes back a folder it made for a company that couldn't be made there, and leaves what was there or was written", async () => {
    const f = fakes();
    // Founding fails; with `writes`, after the org flow wrote a file of its own.
    let writes = false;
    f.make.createCompany = (o) => {
      if (writes) writeTree(o.root, { '.claude/studio.yaml': 'version: 1\n' });
      throw new OrgRefusal('invalid', "Founding the company didn't hire a CEO, so nobody can draft the org.");
    };
    const h = await hub({ f });
    const parent = realpathSync.native(tempDir('worklings-projects-'));
    const made = await post(h.port, '/api/companies', { folder: join(parent, 'plant-pal'), prompt: 'A plant care app' });
    expect([made.status, json(made)]).toEqual([400, { error: "Founding the company didn't hire a CEO, so nobody can draft the org.", code: 'invalid' }]);
    expect(existsSync(join(parent, 'plant-pal'))).toBe(false);
    // A folder that was there stays as it was.
    mkdirSync(join(parent, 'shop'));
    expect((await post(h.port, '/api/companies', { folder: join(parent, 'shop'), prompt: 'A shop' })).status).toBe(400);
    expect(readdirSync(join(parent, 'shop'))).toEqual([]);
    // So does a new one the failed founding wrote into.
    writes = true;
    expect((await post(h.port, '/api/companies', { folder: join(parent, 'bakery'), prompt: 'A bakery' })).status).toBe(400);
    expect(readdirSync(join(parent, 'bakery'))).toEqual(['.claude']);
  });

  it('finishes a removal under way before it closes, and adds no company once it began closing', async () => {
    const f = fakes();
    // Plant Pal's desks close only when the test says, so taking it out of the lobby is under way when the hub closes.
    let letGo = () => {};
    const held = new Promise<void>((done) => {
      letGo = done;
    });
    const plain = f.make.createSwitchboard;
    f.make.createSwitchboard = (o) => (o.companyId === 'plant-pal' ? { ...plain(o), closeAll: () => held } : plain(o));
    const { h, id, company } = await withCompany({ f });
    // The removal's answer may be cut off as the hub shuts: what counts is what it did.
    const removing = raw(h.port, `/api/companies/${id}`, { method: 'DELETE', headers: { ...local(h.port), authorization: `Bearer ${TOKEN}` } }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(company.closed).toBe(true));
    // Queued behind the removal, so it reaches the hub after the hub began closing.
    const cafe = join(realpathSync.native(tempDir('worklings-projects-')), 'cafe-lumen');
    const adding = h.addCompany({ folder: cafe, prompt: 'A café site' });
    const closing = h.close();
    // The hub waits for the removal under way, and answers meanwhile.
    expect((await get(h.port, '/api/lobby')).status).toBe(200);
    letGo();
    await closing;
    await removing;
    await expect(adding).rejects.toMatchObject({ status: 503, code: 'closing' });
    expect(existsSync(cafe)).toBe(false);
    expect(f.companies.map((c) => [c.id, c.closed])).toEqual([['plant-pal', true]]);
  });

  it("takes up the plan's rest again after a restart, from a company resting on it, and rests a company added meanwhile", async () => {
    const home = tempDir('worklings-hubhome-');
    const until = Date.now() + 3_600_000;
    const pause = { reason: 'usage-limit', since: 1_000, until, message: "Resting until 14:00, when your plan's limit resets." };
    const root = realpathSync.native(writeTree(tempDir(), { '.worklings/events.jsonl': `${JSON.stringify({ id: 'cafe-lumen', name: 'Café Lumen', prompt: 'A café', pause })}\n` }));
    writeTree(home, { '.worklings/companies.json': { companies: [{ id: 'cafe-lumen', root }] } });
    const f = fakes();
    const paused: { company: string; until: number | null }[] = [];
    const plain = f.make.createSwitchboard;
    f.make.createSwitchboard = (o) => ({ ...plain(o), pause: (at: number | null) => void paused.push({ company: o.companyId, until: at }) });
    const h = await hub({ home, f });
    expect((await lobby(h.port)).hub.rest).toEqual({ since: 1_000, until });
    // A new company's switchboard rests from the moment it is made, before its CEO's first turn could start.
    expect((await post(h.port, '/api/companies', { folder: join(realpathSync.native(tempDir('worklings-projects-')), 'plant-pal'), prompt: 'A plant care app' })).status).toBe(201);
    expect(paused).toEqual([{ company: 'plant-pal', until }]);
  });

  it('runs only the first of two registered companies whose folders nest, and says why for the other', async () => {
    const home = tempDir('worklings-hubhome-');
    const outer = realpathSync.native(writeTree(tempDir(), { '.worklings/events.jsonl': `${JSON.stringify({ id: 'plant-pal', name: 'Plant Pal', prompt: 'Plants' })}\n` }));
    const inner = join(outer, 'web');
    writeTree(inner, { '.worklings/events.jsonl': `${JSON.stringify({ id: 'cafe-lumen', name: 'Café Lumen', prompt: 'A café' })}\n` });
    // Written by hand: the hub itself never adds a folder inside or around another company's.
    writeTree(home, { '.worklings/companies.json': { companies: [{ id: 'plant-pal', root: outer }, { id: 'cafe-lumen', root: inner }] } });
    const h = await hub({ home });
    expect(h.f.opened).toEqual([outer]);
    expect((await lobby(h.port)).companies).toMatchObject([
      { id: 'plant-pal', problem: null },
      { id: 'cafe-lumen', problem: "Its folder is inside Plant Pal's folder, so it can't run beside it. Remove one of the two from the lobby." },
    ]);
  });
});

describe("the stakeholder's actions", () => {
  it('takes a message to anyone and hands it to the company', async () => {
    const { h, id, company } = await withCompany();
    const sent = await post(h.port, `/api/c/${id}/messages`, { to: 'ux-designer', text: '  Make the palette darker  ' });
    expect([sent.status, json(sent)]).toEqual([202, { id: 'm-1' }]);
    expect(company.calls.at(-1)).toEqual({ method: 'say', args: ['ux-designer', 'Make the palette darker'] });
  });

  it('passes typed on for words the person typed in a box, and nothing for a button or a plain Stop', async () => {
    const { h, id, company } = await withCompany();
    expect((await post(h.port, `/api/c/${id}/messages`, { to: 'ux-designer', text: 'Make the palette darker', typed: true })).status).toBe(202);
    expect(company.calls.at(-1)).toEqual({ method: 'say', args: ['ux-designer', 'Make the palette darker', { typed: true }] });
    expect((await post(h.port, `/api/c/${id}/stop`, { person: 'ux-designer', instruction: 'Use the brand colours', typed: true })).status).toBe(202);
    expect(company.calls.at(-1)).toEqual({ method: 'stop', args: ['ux-designer', 'Use the brand colours', { typed: true }] });
    expect((await post(h.port, `/api/c/${id}/stop`, { person: 'ux-designer', instruction: '', typed: false })).status).toBe(202);
    expect(company.calls.at(-1)).toEqual({ method: 'stop', args: ['ux-designer', ''] });
    const refused = await post(h.port, `/api/c/${id}/messages`, { to: 'ux-designer', text: 'Hi', typed: 'yes' });
    expect([refused.status, json(refused).error]).toEqual([400, 'typed must be true or false.']);
  });

  it("answers a company's refusal with its sentence: 400, 403 for not allowed, 409 for a conflict", async () => {
    const { h, id } = await withCompany();
    const unknown = await post(h.port, `/api/c/${id}/messages`, { to: 'nobody', text: 'Hello?' });
    expect([unknown.status, json(unknown)]).toEqual([400, { error: 'Nobody called nobody works here.', code: 'unknown' }]);
    const notAllowed = await post(h.port, `/api/c/${id}/messages`, { to: 'boss', text: 'Hello?' });
    expect([notAllowed.status, json(notAllowed)]).toEqual([403, { error: 'Only the CEO talks to the board.', code: 'not-allowed' }]);
    const late = await post(h.port, `/api/c/${id}/unsend`, { message: 'm-delivered' });
    expect([late.status, json(late)]).toEqual([409, { error: 'Kai has read it already.', code: 'conflict' }]);
  });

  it('checks every input against the limits before the company sees it', async () => {
    const { h, id, company } = await withCompany();
    const before = company.calls.length;
    const refused = async (path: string, body: unknown) => {
      const res = await post(h.port, `/api/c/${id}/${path}`, body);
      return [res.status, json(res).error];
    };
    expect(await refused('messages', { to: 'ux-designer', text: 'x'.repeat(4_001) })).toEqual([400, 'text is longer than 4,000 characters.']);
    expect(await refused('messages', { to: 'ux-designer', text: 'Hi', cc: 'ceo' })).toEqual([400, 'This takes to, text, typed, not cc.']);
    expect(await refused('messages', { to: 42, text: 'Hi' })).toEqual([400, "to isn't an id this office made."]);
    expect(await refused('messages', { to: '--help', text: 'Hi' })).toEqual([400, "to isn't an id this office made."]);
    expect(await refused('messages', ['ux-designer', 'Hi'])).toEqual([400, 'Send a JSON object.']);
    expect(await refused('answers', { question: 'q-1' })).toEqual([400, 'Pick an option or write an answer.']);
    expect(await refused('answers', { question: 'q-1', option: 7 })).toEqual([400, 'option must be a whole number from 0 to 3.']);
    expect(await refused('approvals', { approval: 'a-1', decision: 'deny', always: true })).toEqual([400, 'Always is for allowing: a denial counts once.']);
    expect(await refused('approvals', { approval: 'a-1', decision: 'maybe' })).toEqual([400, 'decision must be "allow" or "deny".']);
    expect(await refused('settings', { maxDesks: 21 })).toEqual([400, 'maxDesks must be a whole number from 1 to 20.']);
    expect(await refused('settings', {})).toEqual([400, 'Send maxDesks or removeRule.']);
    expect(await refused('office', { change: 'theme', theme: 'neon' })).toEqual([400, expect.stringContaining('theme must be one of office, cafe')]);
    expect(await refused('office', { change: 'look', person: 'ux-designer', look: { body: 'dragon' } })).toEqual([400, expect.stringContaining('look.body: expected one of')]);
    expect(await refused('start', { now: true })).toEqual([400, 'This takes an empty object, not now.']);
    expect(await refused('preset', { preset: 'huge' })).toEqual([400, 'preset must be "lean" or "balanced" or "thorough".']);
    expect(await refused('preset', {})).toEqual([400, 'preset must be "lean" or "balanced" or "thorough".']);
    expect(await refused('preset', { preset: 'lean', resize: 'yes' })).toEqual([400, 'resize must be true or false.']);
    expect(await refused('preset', { preset: 'lean', size: 3 })).toEqual([400, 'This takes preset, resize, not size.']);
    expect(await refused('budget', {})).toEqual([400, 'Send company or person: a dollar amount, or null for none.']);
    expect(await refused('budget', { company: 0 })).toEqual([400, 'company must be a dollar amount from $0.01 to $1,000,000, or null for none.']);
    expect(await refused('budget', { person: -2 })).toEqual([400, 'person must be a dollar amount from $0.01 to $1,000,000, or null for none.']);
    expect(await refused('budget', { company: '50' })).toEqual([400, 'company must be a dollar amount from $0.01 to $1,000,000, or null for none.']);
    expect(await refused('budget', { company: 2_000_000 })).toEqual([400, 'company must be a dollar amount from $0.01 to $1,000,000, or null for none.']);
    expect(await refused('budget', { team: 5 })).toEqual([400, 'This takes company, person, not team.']);
    expect(await refused('models', {})).toEqual([400, 'Send the model for a level: ceo, head, lead, worker.']);
    expect(await refused('models', { head: 'gpt-9' })).toEqual([400, 'head must be "inherit" or "sonnet" or "opus" or "haiku".']);
    expect(await refused('models', { boss: 'opus' })).toEqual([400, 'This takes ceo, head, lead, worker, not boss.']);
    expect(await refused('looked', { at: 1 })).toEqual([400, 'This takes an empty object, not at.']);
    expect(await refused('looked', [])).toEqual([400, 'Send a JSON object.']);
    expect((await post(h.port, `/api/c/${id}/messages`, { to: 'ux-designer', text: 'x'.repeat(40_000) })).status).toBe(413);
    expect((await post(h.port, `/api/c/${id}/messages`, '{nope')).status).toBe(400);
    expect((await post(h.port, `/api/c/${id}/messages`, '{}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect(company.calls.length).toBe(before);
  });

  it.each([
    ['stop', { person: 'ux-designer', instruction: 'Use the brand colours instead' }, 202, 'stop', ['ux-designer', 'Use the brand colours instead']],
    ['unsend', { message: 'm-7' }, 200, 'unsend', ['m-7']],
    ['undo', { item: 'q-1' }, 200, 'undo', ['q-1']],
    ['inbox/batch', { batch: 'q-1' }, 200, 'answerBatch', ['q-1']],
    ['answers', { question: 'q-1', option: 1 }, 200, 'answer', ['q-1', { option: 1, text: '' }]],
    ['answers', { question: 'q-1', text: 'Both, please' }, 200, 'answer', ['q-1', { option: null, text: 'Both, please' }]],
    ['approvals', { approval: 'a-1', decision: 'deny', note: 'Not on a Friday' }, 200, 'decide', ['a-1', { decision: 'deny', always: false, note: 'Not on a Friday' }]],
    ['approvals', { approval: 'a-1', decision: 'allow', always: true }, 200, 'decide', ['a-1', { decision: 'allow', always: true, note: null }]],
    ['proposal', { restore: true }, 200, 'restoreProposal', []],
    ['handover', { person: 'ux-designer' }, 200, 'handOver', ['ux-designer']],
    ['bringback', { person: 'ux-designer' }, 200, 'bringBack', ['ux-designer']],
    ['settings', { maxDesks: 3 }, 200, 'updateSettings', [{ maxDesks: 3 }]],
    ['settings', { removeRule: 'Bash(npm test)' }, 200, 'updateSettings', [{ removeRule: 'Bash(npm test)' }]],
    ['seen', { person: 'ux-designer' }, 204, 'markSeen', ['ux-designer']],
    ['looked', {}, 204, 'markLooked', []],
    ['preset', { preset: 'lean' }, 200, 'setPreset', ['lean', { resize: true }]],
    ['preset', { preset: 'thorough', resize: false }, 200, 'setPreset', ['thorough', { resize: false }]],
    ['budget', { company: 50 }, 200, 'setBudget', [{ company: 50 }]],
    ['budget', { company: null, person: 5.5 }, 200, 'setBudget', [{ company: null, person: 5.5 }]],
    ['models', { head: 'opus', worker: 'haiku' }, 200, 'setModels', [{ head: 'opus', worker: 'haiku' }]],
    ['start', {}, 200, 'start', []],
    ['pause', {}, 200, 'pause', []],
    ['resume', {}, 200, 'resume', []],
    ['office', { change: 'add-room', room: { id: 'games', kind: 'games', theme: 'arcade' } }, 200, 'changeOffice', ['@stakeholder', { change: 'add-room', room: { id: 'games', title: 'Games', kind: 'games', theme: 'arcade' } }]],
    ['office', { change: 'decor', add: ['plants'] }, 200, 'changeOffice', ['@stakeholder', { change: 'decor', add: ['plants'], remove: [] }]],
    ['dashboards/remove', { dashboard: 'd-3' }, 200, 'removeDashboard', ['@stakeholder', 'd-3']],
  ])('POST %s reaches the company', async (path, body, status, method, args) => {
    const { h, id, company } = await withCompany();
    const res = await post(h.port, `/api/c/${id}/${path}`, body);
    expect(res.status).toBe(status);
    expect(company.calls.at(-1)).toEqual({ method, args });
  });

  it("sends the proposal's schema sentences back when an edit doesn't check out", async () => {
    const { h, id } = await withCompany();
    const res = await post(h.port, `/api/c/${id}/proposal`, { proposal: 'broken' });
    expect([res.status, json(res)]).toEqual([400, { ok: false, errors: ['Design has seven people and no team lead.'], error: 'Design has seven people and no team lead.' }]);
  });

  it("won't bring someone back while their session is still open in Claude Code", async () => {
    const { h, id, root, company } = await withCompany();
    const since = Date.now() - 60_000;
    company.state.people = company.state.people.map((p) => (p.id === 'ux-designer' ? { ...p, desk: { ...p.desk, state: 'away' as const, sessionId: DESK, since } } : p));
    const transcript = join(transcriptDir(root, h.claude), `${DESK}.jsonl`);
    writeTree(transcriptDir(root, h.claude), { [`${DESK}.jsonl`]: '{}\n' });
    const refused = await post(h.port, `/api/c/${id}/bringback`, { person: 'ux-designer' });
    expect([refused.status, json(refused)]).toEqual([409, { error: "Close Kai's session in Claude Code first.", code: 'still-open' }]);
    expect(company.calls.some((c) => c.method === 'bringBack')).toBe(false);
    const old = (Date.now() - 45_000) / 1000;
    utimesSync(transcript, old, old);
    expect((await post(h.port, `/api/c/${id}/bringback`, { person: 'ux-designer' })).status).toBe(200);
  });

  it("gives each lobby card the company's summary, with the preview's address only while it is up", async () => {
    const { h, id, company } = await withCompany();
    const summary: CompanySummary = {
      goal: 'A plant care app with watering streaks',
      stage: 'working',
      milestones: { done: 1, planned: 3 },
      tasks: { done: 4, planned: 9 },
      achieved: [],
      working: [{ name: 'Kai', task: 'Streak card' }],
      needs: { count: 0, items: [] },
      spend: { spent: 1.2, budget: 20 },
      preview: null,
      movedAt: 1,
      checklist: { met: 0, partly: 0, 'not-met': 0, unchecked: 4 },
    };
    const entry = company.lobbyEntry.bind(company);
    company.lobbyEntry = () => ({ ...entry(), summary });
    expect((await lobby(h.port)).companies[0]?.summary).toEqual(summary);
    expect((await post(h.port, `/api/c/${id}/preview`, { action: 'start' })).status).toBe(200);
    expect((await lobby(h.port)).companies[0]?.summary?.preview).toBe('http://127.0.0.1:5999/');
    expect((await post(h.port, `/api/c/${id}/preview`, { action: 'stop' })).status).toBe(200);
    expect((await lobby(h.port)).companies[0]?.summary?.preview).toBeNull();
  });

  it('starts and stops the preview behind its proxy, and lets a page frame a preview started after it loaded', async () => {
    const web = writeTree(tempDir(), { 'index.html': '<!doctype html><title>Office</title>' });
    const { h, id } = await withCompany({ webDir: web });
    // Served before any preview runs, the page may already frame the proxy's port, whatever it turns out to be.
    const page = await raw(h.port, `/c/${id}/preview`, { headers: local(h.port) });
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toMatch(/; frame-src http:\/\/127\.0\.0\.1:\*$/);
    expect(page.headers['x-frame-options']).toBe('DENY');
    const started = await post(h.port, `/api/c/${id}/preview`, { action: 'start' });
    expect([started.status, json(started)]).toEqual([200, { state: 'up', url: 'http://127.0.0.1:5999/', command: 'npm run dev', problem: null }]);
    expect((await state(h.port, id)).company?.preview).toMatchObject({ state: 'up', url: 'http://127.0.0.1:5999/' });
    expect(json(await post(h.port, `/api/c/${id}/preview`, { action: 'stop' }))).toMatchObject({ state: 'off', url: null });
    // Without --tailnet, the previews have no tailnet to serve on.
    expect(h.f.previewOptions?.tailnet?.()).toBeNull();
  });

  it("with --tailnet, lets the previews serve on the tailnet and the pages frame them there", async () => {
    const web = writeTree(tempDir(), { 'index.html': '<!doctype html><title>Office</title>' });
    const { h, id } = await withCompany({ webDir: web, tailnet: true });
    const page = await raw(h.port, `/c/${id}`, { headers: local(h.port) });
    expect(page.headers['content-security-policy']).toMatch(/; frame-src http:\/\/127\.0\.0\.1:\* https:\/\/box\.tail1234\.ts\.net:\*$/);
    const tailnet = h.f.previewOptions?.tailnet?.();
    if (!tailnet) throw new Error('the previews were given no tailnet');
    const entry = await tailnet.serve(55_123);
    expect(entry).toMatchObject({ host: 'box.tail1234.ts.net', port: 55_123, url: 'https://box.tail1234.ts.net:55123/' });
    await entry.stop();
    expect([h.f.tailnet.served, h.f.tailnet.unserved]).toEqual([[55_123], [55_123]]);
  });

  it("serves a shared screenshot only when it is the company's own, as a PNG", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of the image')]);
    const { h, id, root, company } = await withCompany();
    mkdirSync(join(root, '.worklings', 'shots'), { recursive: true });
    writeFileSync(join(root, '.worklings', 'shots', 's-1.png'), png);
    writeFileSync(join(root, '.worklings', 'shots', 's-2.png'), png);
    writeFileSync(join(root, '.worklings', 'shots', 's-3.png'), 'not a png');
    company.state.screenshots = [{ id: 's-1', person: 'ux-designer', caption: 'The home screen', at: 1 }, { id: 's-3', person: 'ux-designer', caption: 'Odd', at: 2 }];
    const shot = await fetch(`http://127.0.0.1:${h.port}/api/c/${id}/screenshots/s-1?token=${TOKEN}`);
    expect([shot.status, shot.headers.get('content-type'), shot.headers.get('x-content-type-options')]).toEqual([200, 'image/png', 'nosniff']);
    expect(Buffer.from(await shot.arrayBuffer())).toEqual(png);
    for (const other of ['s-2', 's-3', 's-1.png', '..%2Fevents', 'x:y']) expect((await get(h.port, `/api/c/${id}/screenshots/${other}`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${h.port}/api/c/${id}/screenshots/s-1`)).status).toBe(401);
  });

  it("sends a task's diff as the company reads it, as text, and the company's sentence when there is none", async () => {
    const { h, id, company } = await withCompany();
    const diff = await get(h.port, `/api/c/${id}/tasks/t-1/diff`);
    expect([diff.status, diff.headers['content-type'], diff.headers['x-content-type-options'], diff.body]).toEqual([200, 'text/plain; charset=utf-8', 'nosniff', 'diff --git a/menu.html b/menu.html\n+<h1>Menu</h1>\n']);
    expect(company.calls.at(-1)).toEqual({ method: 'diff', args: ['t-1'] });
    const missing = await get(h.port, `/api/c/${id}/tasks/t-9/diff`);
    expect([missing.status, json(missing)]).toEqual([400, { error: 'There is no task t-9 in this company.', code: 'unknown' }]);
    expect((await get(h.port, `/api/c/${id}/tasks/--all/diff`)).status).toBe(404);
    expect(company.calls.filter((c) => c.method === 'diff')).toHaveLength(2);
  });

  it("keeps the hub's cap across companies, and gives v2's office routes under the company", async () => {
    const { h, id } = await withCompany();
    expect([(await post(h.port, '/api/hub/settings', { maxDesks: 3 })).status, (await post(h.port, '/api/hub/settings', { maxDesks: 51 })).status]).toEqual([200, 400]);
    expect(h.f.switchboards[0]?.gate?.max).toBe(3);
    expect((await lobby(h.port)).hub.maxDesks).toBe(3);
    expect(JSON.parse(readFileSync(join(h.home, '.worklings', 'settings.json'), 'utf8'))).toEqual({ maxDesks: 3 });
    expect(json(await get(h.port, `/api/c/${id}/studio`))).toMatchObject({ source: 'none', departments: expect.any(Object) });
    expect(JSON.parse((await get(h.port, `/api/c/${id}/sessions`)).body)).toEqual([]);
    expect(json(await post(h.port, `/api/c/${id}/catch-up`, {}))).toMatchObject({ source: 'nothing-new' });
    expect((await post(h.port, `/api/c/${id}/replay`, { play: true })).status).toBe(404);
  });
});

/** Messages m-1 to m-<n> as the company keeps them, oldest first, every third acknowledged by Kai. */
function keptMessages(n: number): { messages: Message[]; acks: Ack[] } {
  const messages = Array.from({ length: n }, (_, i): Message => ({
    id: `m-${i + 1}`, from: '@stakeholder', to: 'ux-designer', text: `Note ${i + 1}.`, origin: null, relayOf: null, note: null, at: 1_000 + i, deliveredAt: 1_001 + i, interrupt: false,
  }));
  const acks = messages.filter((_, i) => i % 3 === 0).map((m): Ack => ({ id: `k-${m.id.slice(2)}`, message: m.id, by: m.to, agree: true, text: 'On it.', at: m.at + 5 }));
  return { messages, acks };
}

/** m-<from> down to m-<to>. */
const down = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => `m-${from - i}`);
const page = (r: { body: string }) => JSON.parse(r.body) as MessagePage;

describe("the company's earlier messages", () => {
  it('pages back through what the company keeps, 200 at a time, newest first, with their acknowledgements', async () => {
    const { h, id, company } = await withCompany();
    company.kept = keptMessages(450);
    const first = await get(h.port, `/api/c/${id}/messages?before=m-401`);
    expect([first.status, first.headers['content-type'], first.headers['cache-control']]).toEqual([200, 'application/json; charset=utf-8', 'no-store']);
    expect(page(first).messages.map((m) => m.id)).toEqual(down(400, 201));
    expect(page(first).acks.map((a) => a.message)).toEqual(company.kept.acks.filter((a) => Number(a.message.slice(2)) >= 201 && Number(a.message.slice(2)) <= 400).map((a) => a.message));
    expect(page(first).more).toBe(true);
    expect(company.calls.at(-1)).toEqual({ method: 'earlierMessages', args: ['m-401', 200] });
    // A full page that reaches the first message says so.
    const second = page(await get(h.port, `/api/c/${id}/messages?before=m-201`));
    expect([second.messages.map((m) => m.id), second.more]).toEqual([down(200, 1), false]);
    expect(second.messages[0]).toEqual(company.kept.messages[199]);
    expect(page(await get(h.port, `/api/c/${id}/messages?before=m-1`))).toEqual({ messages: [], acks: [], more: false });
  });

  it('takes a limit from 1 to 200', async () => {
    const { h, id, company } = await withCompany();
    company.kept = keptMessages(450);
    const ask = async (query: string) => page(await get(h.port, `/api/c/${id}/messages?${query}`));
    expect((await ask('before=m-401&limit=1')).messages.map((m) => m.id)).toEqual(['m-400']);
    expect((await ask('before=m-401&limit=37')).messages).toHaveLength(37);
    expect((await ask('limit=200&before=m-450')).messages).toHaveLength(200);
    expect(await ask('before=m-30&limit=50')).toMatchObject({ more: false, messages: down(29, 1).map((m) => expect.objectContaining({ id: m })) });
    expect(company.calls.filter((c) => c.method === 'earlierMessages').map((c) => c.args)).toEqual([['m-401', 1], ['m-401', 37], ['m-450', 200], ['m-30', 50]]);
  });

  it('refuses a query it cannot read in a sentence, before the company sees it', async () => {
    const { h, id, company } = await withCompany();
    company.kept = keptMessages(10);
    const refused = async (query: string) => {
      const res = await get(h.port, `/api/c/${id}/messages${query}`);
      return [res.status, json(res).error, json(res).code];
    };
    const noBefore = [400, 'Send before: the id of the oldest message you have.', 'bad-input'];
    const notAnId = [400, "before isn't an id this office made.", 'bad-input'];
    const badLimit = [400, 'limit must be a whole number from 1 to 200.', 'bad-input'];
    expect(await refused('')).toEqual(noBefore);
    expect(await refused('?limit=10')).toEqual(noBefore);
    for (const before of ['', '--help', '..%2Fevents', `m-${'1'.repeat(130)}`, 'constructor']) expect(await refused(`?before=${before}`)).toEqual(notAnId);
    for (const limit of ['0', '201', 'abc', '1.5', '', '1e2', '-5', '%2B5', '0x10', '%205']) expect(await refused(`?before=m-5&limit=${limit}`)).toEqual(badLimit);
    expect(await refused('?before=m-5&page=2')).toEqual([400, 'This takes before, limit, not page.', 'bad-input']);
    expect(await refused('?before=m-5&before=m-6')).toEqual([400, 'Send before once.', 'bad-input']);
    expect(await refused('?before=m-5&limit=5&limit=6')).toEqual([400, 'Send limit once.', 'bad-input']);
    // A name too long or odd to say back isn't said back.
    const odd = await refused(`?before=m-5&${'x'.repeat(5_000)}=1`);
    expect(odd).toEqual([400, 'This takes before, limit and nothing else.', 'bad-input']);
    expect(await refused('?before=m-5&%3Cscript%3E=1')).toEqual([400, 'This takes before, limit and nothing else.', 'bad-input']);
    expect(company.calls.filter((c) => c.method === 'earlierMessages')).toEqual([]);
  });

  it("says in a sentence when the company doesn't keep the message", async () => {
    const { h, id, company } = await withCompany();
    company.kept = keptMessages(10);
    const missing = await get(h.port, `/api/c/${id}/messages?before=m-9999`);
    expect([missing.status, json(missing)]).toEqual([400, { error: NOT_KEPT, code: 'unknown' }]);
  });

  it('answers only with the access token, from the office itself, as every company route does', async () => {
    const { h, id, company } = await withCompany();
    company.kept = keptMessages(10);
    const path = `/api/c/${id}/messages?before=m-5`;
    expect((await raw(h.port, path, { headers: local(h.port) })).status).toBe(401);
    expect((await get(h.port, path, { authorization: 'Bearer not-the-token' })).status).toBe(401);
    expect((await get(h.port, path, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await get(h.port, path, { host: 'attacker.example' })).status).toBe(403);
    expect(company.calls.filter((c) => c.method === 'earlierMessages')).toEqual([]);
    // The token may come in the query, as the hub takes it everywhere; it isn't a parameter this route refuses.
    const withToken = await raw(h.port, `${path}&token=${TOKEN}`, { headers: local(h.port) });
    expect([withToken.status, page(withToken).messages.map((m) => m.id)]).toEqual([200, down(4, 1)]);
    expect(json(await get(h.port, '/api/c/nope/messages?before=m-5'))).toEqual({ error: "That company isn't in the lobby any more.", code: 'gone' });
  });
});

describe("the office in a company's folder", () => {
  it('draws a desk session as its person, and other sessions in the folder as visitors', async () => {
    const { h, id, root, company } = await withCompany({ files: { '.claude/studio.yaml': STUDIO } });
    company.sessionMap.set(DESK, 'ux-designer');
    const hook = (payload: object) => raw(h.port, '/hooks?from=worklings', { method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect((await hook({ session_id: DESK, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'From Ada, head of design: make it darker' })).status).toBe(200);
    await hook({ session_id: VISITOR, cwd: join(root, 'src'), hook_event_name: 'UserPromptSubmit', prompt: 'Run the tests for me please' });
    await hook({ session_id: 'elsewhere-session', cwd: tempDir(), hook_event_name: 'UserPromptSubmit', prompt: 'Not in this company at all' });
    const snapshot = await state(h.port, id);
    expect(snapshot.agents.map((a) => [a.sessionId, a.kind, a.roleId, a.name])).toEqual([
      [DESK, 'role', 'ux-designer', 'UX designer'],
      [VISITOR, 'lead', null, 'Lead'],
    ]);
    expect(snapshot.company?.people.find((p) => p.id === 'ux-designer')?.agentKey).toBe(`${DESK}:lead`);
    expect(snapshot.company?.people.find((p) => p.id === 'ceo')?.agentKey).toBeNull();
  });

  it("shows what a person's desk has spent so far in a turn the company hasn't priced yet, subagents included", async () => {
    const { h, id, root, company } = await withCompany({ files: { '.claude/studio.yaml': STUDIO } });
    company.sessionMap.set(DESK, 'ux-designer');
    const dir = transcriptDir(root, h.claude);
    const main = join(dir, `${DESK}.jsonl`);
    writeTree(dir, {
      [`${DESK}.jsonl`]: answered('msg_desk', 40_000, 2_000),
      [`${DESK}/subagents/agent-a4b1c2d3e5f60718.jsonl`]: answered('msg_sub', 10_000, 500),
      [`${VISITOR}.jsonl`]: answered('msg_visitor', 90_000, 9_000),
    });
    await sendHook(h.port, { session_id: DESK, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Make the palette darker', transcript_path: main });
    await sendHook(h.port, { session_id: DESK, cwd: root, hook_event_name: 'SubagentStart', agent_id: 'a4b1c2d3e5f60718', agent_type: 'general-purpose', transcript_path: main });
    await sendHook(h.port, { session_id: VISITOR, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Run the tests for me please', transcript_path: join(dir, `${VISITOR}.jsonl`) });
    // The office reads transcripts at its next poll, within a second.
    const snapshot = await vi.waitFor(async () => {
      const s = await state(h.port, id);
      expect(s.agents.filter((a) => a.requests > 0).map((a) => a.key).sort()).toEqual([`${DESK}:a4b1c2d3e5f60718`, `${DESK}:lead`, `${VISITOR}:lead`].sort());
      return s;
    }, { timeout: 5_000, interval: 50 });
    const spent = (session: string) => snapshot.agents.filter((a) => a.sessionId === session).reduce((sum, a) => sum + agentCost(a), 0);
    expect(spent(DESK)).toBeGreaterThan(0);
    const people = snapshot.company?.people ?? [];
    expect(people.find((p) => p.id === 'ux-designer')?.cost).toBeCloseTo(spent(DESK), 12);
    // The visitor's spend is in the top bar's total and nobody's in the company.
    expect(people.filter((p) => p.id !== 'ux-designer').every((p) => p.cost === 0)).toBe(true);
    expect(snapshot.totals.cost).toBeCloseTo(spent(DESK) + spent(VISITOR), 12);
  });

  it('never shows a person less than the company recorded from their finished turns', async () => {
    const { h, id, root, company } = await withCompany({ files: { '.claude/studio.yaml': STUDIO } });
    company.sessionMap.set(DESK, 'ux-designer');
    company.state.people = company.state.people.map((p) => (p.id === 'ux-designer' ? { ...p, cost: 12.5 } : p));
    const dir = transcriptDir(root, h.claude);
    writeTree(dir, { [`${DESK}.jsonl`]: answered('msg_desk', 40_000, 2_000) });
    await sendHook(h.port, { session_id: DESK, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Make the palette darker', transcript_path: join(dir, `${DESK}.jsonl`) });
    const { snapshot, desk } = await vi.waitFor(async () => {
      const s = await state(h.port, id);
      const agent = s.agents.find((a) => a.key === `${DESK}:lead`);
      if (agent?.requests !== 1) throw new Error('the office has not read the transcript yet');
      return { snapshot: s, desk: agent };
    }, { timeout: 5_000, interval: 50 });
    // Less than recorded, as when this hub's office has read only part of what a person did, after a restart say.
    expect(agentCost(desk)).toBeGreaterThan(0);
    expect(agentCost(desk)).toBeLessThan(12.5);
    expect(snapshot.company?.people.find((p) => p.id === 'ux-designer')?.cost).toBe(12.5);
  });

  it("takes a desk's hooks by its token, from its worktree too", async () => {
    const { h, id, root } = await withCompany({ files: { '.claude/studio.yaml': STUDIO } });
    const token = h.f.switchboards[0]?.hub.issue('ux-designer', join(root, '..', 'plant-pal-t3')) ?? '';
    const res = await raw(h.port, '/desk/hook', {
      method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', 'x-worklings-desk': token },
      body: JSON.stringify({ session_id: DESK, cwd: join(root, '..', 'plant-pal-t3'), hook_event_name: 'Stop', last_assistant_message: 'The palette is darker now.' }),
    });
    expect([res.status, res.body]).toEqual([200, '']);
    await vi.waitFor(async () => expect((await state(h.port, id)).agents).toMatchObject([{ sessionId: DESK, kind: 'role', roleId: 'ux-designer', lastMessage: 'The palette is darker now.' }]));
  });
});

describe('desk intake', () => {
  async function desk() {
    const c = await withCompany();
    const token = c.h.f.switchboards[0]?.hub.issue('ux-designer') ?? '';
    const ask = (body: object, headers: Record<string, string> = {}) =>
      raw(c.h.port, '/desk/permission', { method: 'POST', headers: { ...local(c.h.port), 'content-type': 'application/json', 'x-worklings-desk': token, ...headers }, body: JSON.stringify(body) });
    return { ...c, token, ask };
  }

  it("refuses the desks' routes without a desk's own token, and from anywhere but this machine", async () => {
    const { h, token } = await desk();
    const body = JSON.stringify(permissionPayload);
    for (const path of ['/desk/permission', '/desk/hook']) {
      const send = (headers: Record<string, string>) => raw(h.port, path, { method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', ...headers }, body });
      expect(json(await send({}))).toEqual({ error: "This needs a desk's own token.", code: 'desk-token' });
      expect((await send({ 'x-worklings-desk': 'f'.repeat(64) })).status).toBe(403);
      expect((await send({ authorization: `Bearer ${TOKEN}` })).status).toBe(403);
      expect(json(await send({ 'x-worklings-desk': token, host: 'evil.example' })).code).toBe('host');
      const elsewhere: Record<string, string>[] = [{ origin: `http://127.0.0.1:${h.port}` }, { 'x-forwarded-for': '100.64.0.7' }, { 'tailscale-funnel-request': '?1' }];
      for (const from of elsewhere) {
        expect(json(await send({ 'x-worklings-desk': token, ...from }))).toEqual({ error: 'The hub takes this only from Claude Code on this machine.', code: 'local-only' });
      }
    }
  });

  it('answers the org tools only for a desk token, as that person, and never with the web app', async () => {
    const { h, id, root, token } = await desk();
    const mcp = (headers: Record<string, string>, method = 'POST') => raw(h.port, '/mcp', { method, headers: { ...local(h.port), 'content-type': 'application/json', ...headers }, body: '{}' });
    const none = await mcp({});
    expect([none.status, none.headers['www-authenticate'], json(none)]).toEqual([401, 'Bearer realm="worklings-org"', { jsonrpc: '2.0', error: { code: -31001, message: "This desk's token is missing or wrong." } }]);
    expect((await mcp({ authorization: `Bearer ${'0'.repeat(64)}` })).headers['www-authenticate']).toBe('Bearer realm="worklings-org", error="invalid_token"');
    expect((await mcp({ authorization: `Bearer ${TOKEN}` })).status).toBe(401);
    expect(json(await mcp({ authorization: `Bearer ${token}` }))).toEqual({ companyId: id, person: 'ux-designer', root, cwd: root });
    expect((await mcp({ authorization: `Bearer ${token}`, 'x-forwarded-for': '100.64.0.7' })).status).toBe(403);
    expect((await mcp({ authorization: `Bearer ${token}`, origin: 'https://evil.example' })).status).toBe(403);
    expect((await raw(h.port, '/mcp', { headers: local(h.port) })).status).toBe(405);
    for (const probe of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
      const res = await raw(h.port, probe, { headers: local(h.port) });
      expect([res.status, res.headers['content-type']]).toEqual([404, 'application/json; charset=utf-8']);
    }
    expect((await raw(h.port, '/register', { method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    h.f.switchboards[0]?.hub.revoke(token);
    expect((await mcp({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("allows at once what the policy allows, in Claude Code's answer format", async () => {
    const { h, ask, company, root } = await desk();
    const res = await ask(permissionPayload);
    expect([res.status, json(res)]).toEqual([200, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }]);
    expect(company.approvalsAsked).toEqual([]);
    expect(h.f.classified).toEqual([{ root, cwd: root, branch: null, rules: ['Bash(npm test)'], scratch: null, person: 'ux-designer', leash: 'default' }]);
  });

  it("judges a desk's request in its own worktree", async () => {
    const { h, root } = await withCompany();
    const worktree = join(root, '..', 'plant-pal-t3');
    const token = h.f.switchboards[0]?.hub.issue('ux-designer', worktree) ?? '';
    await raw(h.port, '/desk/permission', { method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(permissionPayload) });
    expect(h.f.classified.at(-1)).toMatchObject({ root, cwd: worktree });
  });

  it("puts an ask in the inbox and answers once the stakeholder decides, with the policy's words", async () => {
    const { h, ask, company, root } = await desk();
    h.f.verdict.next = { verdict: 'ask', kind: 'push', summary: 'Push the work branch to GitHub', detail: 'git push origin worklings/plant-pal', alwaysRule: { rule: 'Bash(git push origin:*)', sentence: 'any git push to origin' } };
    const before = Date.now();
    const pending = ask({ ...permissionPayload, tool_name: 'Bash', tool_input: { command: 'git push origin worklings/plant-pal' }, cwd: root });
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(1));
    const asked = company.approvalsAsked[0];
    expect(asked?.person).toBe('ux-designer');
    expect(asked?.ask).toMatchObject({ tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push origin worklings/plant-pal', kind: 'push', alwaysRule: { rule: 'Bash(git push origin:*)' } });
    expect(asked?.ask.expiresAt).toBeGreaterThanOrEqual(before + 590_000);
    asked?.answer({ decision: 'deny', always: false, note: ' Not before the review. ' });
    const res = await pending;
    expect(json(res)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: "The stakeholder said no to this: Not before the review. Don't try it again; carry on without it, or tell your manager what you need." } },
    });
    expect(asked?.signal?.aborted).toBe(false);
    const allowed = ask(permissionPayload);
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(2));
    company.approvalsAsked[1]?.answer({ decision: 'allow', always: true, note: null });
    expect(json(await allowed)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    const plain = ask(permissionPayload);
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(3));
    company.approvalsAsked[2]?.answer({ decision: 'deny', always: false, note: null });
    expect((json(await plain).hookSpecificOutput as { decision: unknown }).decision).toEqual({ behavior: 'deny', message: "The stakeholder said no to this. Don't try it again; carry on without it, or tell your manager what you need." });
  });

  it("judges a request by the person's leash: Trusted runs routine in-project work, the ask list still asks", async () => {
    const f = fakes();
    f.make.classifyPermission = (payload, o) => {
      f.classified.push(o);
      return classifyPermission(payload, o);
    };
    const { h, root, company } = await withCompany({ f, approvalWaitMs: 5_000 });
    const token = h.f.switchboards[0]?.hub.issue('ux-designer', root) ?? '';
    const run = (command: string) =>
      raw(h.port, '/desk/permission', {
        method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', 'x-worklings-desk': token },
        body: JSON.stringify({ ...permissionPayload, cwd: root, tool_name: 'Bash', tool_input: { command } }),
      });
    const decision = (res: Awaited<ReturnType<typeof run>>) => (json(res).hookSpecificOutput as { decision: { behavior: string } }).decision.behavior;
    const leash = (value: 'default' | 'trusted') => {
      company.state.steering = { plan: null, acks: [], decisions: [], settings: { planApproval: 'off', leash: { people: {}, rooms: {} }, effort: {} }, people: { 'ux-designer': { leash: value, leashFrom: 'person', effort: null } } };
    };
    // A program the policy doesn't know: asked under the default leash, routine for a Trusted person.
    leash('default');
    const asked = run('frobnicate --all src/app.ts');
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(1));
    company.approvalsAsked[0]?.answer({ decision: 'deny', always: false, note: null });
    expect(decision(await asked)).toBe('deny');
    expect(f.classified.at(-1)).toMatchObject({ leash: 'default' });
    leash('trusted');
    expect(decision(await run('frobnicate --all src/app.ts'))).toBe('allow');
    expect(f.classified.at(-1)).toMatchObject({ leash: 'trusted' });
    // What leaves the project or is visible to others still asks.
    const push = run('git push origin main');
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(2));
    expect(company.approvalsAsked[1]?.ask).toMatchObject({ kind: 'push' });
    company.approvalsAsked[1]?.answer({ decision: 'deny', always: false, note: null });
    expect(decision(await push)).toBe('deny');
  });

  it("lets a desk work in its own scratch folder through the hub's policy, while another desk's still asks", async () => {
    const f = fakes();
    // The real approvals policy, judging what the hub tells it about the desk.
    f.make.classifyPermission = (payload, o) => {
      f.classified.push(o);
      return classifyPermission(payload, o);
    };
    const { h, root, company } = await withCompany({ f, approvalWaitMs: 5_000 });
    const [own, kais] = [realpathSync.native(tempDir('worklings-scratch-')), realpathSync.native(tempDir('worklings-scratch-'))];
    const board = h.f.switchboards[0];
    const token = board?.hub.issue('ceo', root, own) ?? '';
    board?.hub.issue('ux-designer', root, kais);
    const write = (file: string) =>
      raw(h.port, '/desk/permission', {
        method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', 'x-worklings-desk': token },
        body: JSON.stringify({ ...permissionPayload, cwd: root, tool_name: 'Write', tool_input: { file_path: file, content: 'notes' } }),
      });
    expect(json(await write(join(own, 'notes.md')))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    expect(company.approvalsAsked).toEqual([]);
    expect(f.classified.at(-1)).toMatchObject({ root, scratch: own });
    const asked = write(join(kais, 'notes.md'));
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(1));
    expect(company.approvalsAsked[0]?.ask).toMatchObject({ tool: 'Write', kind: 'outside-project' });
    company.approvalsAsked[0]?.answer({ decision: 'deny', always: false, note: null });
    expect((json(await asked).hookSpecificOutput as { decision: { behavior: string } }).decision.behavior).toBe('deny');
  });

  it("lets a desk stop what it started by its process id, reading its processes only for a stop, while another desk's process still asks", async () => {
    const f = fakes();
    f.make.classifyPermission = (payload, o) => {
      f.classified.push(o);
      return classifyPermission(payload, o);
    };
    // What the office recorded per desk, by the desk's scratch folder (src/runtime/descendants.ts, startedBy).
    const started = new Map<string, number[]>();
    const reads: string[] = [];
    f.make.ownProcesses = async (scratch) => {
      reads.push(scratch);
      return started.get(scratch) ?? [];
    };
    f.make.stopsByPid = stopsByPid;
    const { h, root, company } = await withCompany({ f, approvalWaitMs: 5_000 });
    const [own, kais] = [realpathSync.native(tempDir('worklings-scratch-')), realpathSync.native(tempDir('worklings-scratch-'))];
    started.set(own, [62504]);
    started.set(kais, [50768]);
    const board = h.f.switchboards[0];
    const token = board?.hub.issue('ceo', root, own) ?? '';
    const run = (command: string) =>
      raw(h.port, '/desk/permission', {
        method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', 'x-worklings-desk': token },
        body: JSON.stringify({ ...permissionPayload, cwd: root, tool_name: 'Bash', tool_input: { command } }),
      });
    const stop = (pid: number) => (process.platform === 'win32' ? `taskkill //PID ${pid} //F` : `kill ${pid}`);
    const decision = (res: Awaited<ReturnType<typeof raw>>) => (json(res).hookSpecificOutput as { decision: { behavior: string } }).decision.behavior;

    // A command that stops nothing reads no process table.
    expect(decision(await run('npm test'))).toBe('allow');
    expect(reads).toEqual([]);
    expect(f.classified.at(-1)).not.toHaveProperty('ownProcesses');

    expect(decision(await run(stop(62504)))).toBe('allow');
    expect(reads).toEqual([own]);
    expect(f.classified.at(-1)).toMatchObject({ scratch: own, ownProcesses: [62504] });
    expect(company.approvalsAsked).toEqual([]);

    // Kai's server is Kai's to stop: from this desk it goes to the stakeholder.
    const asked = run(stop(50768));
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(1));
    expect(company.approvalsAsked[0]?.ask).toMatchObject({ tool: 'Bash', kind: 'other', summary: 'Stop a program that is running on the computer' });
    company.approvalsAsked[0]?.answer({ decision: 'deny', always: false, note: null });
    expect(decision(await asked)).toBe('deny');
  });

  it("puts nothing to the stakeholder for a request whose connection closed while the hub was still reading it", async () => {
    const { h, company, token } = await desk();
    h.f.verdict.next = { verdict: 'ask', kind: 'deploy', summary: 'Deploy the site', detail: 'npm run deploy', alwaysRule: null };
    // Claude Code gives up while the body is still on its way in, so the hub hears the close before it has read it.
    h.server.once('request', (_req, res) => {
      res.emit('close');
    });
    const req = request({ host: '127.0.0.1', port: h.port, path: '/desk/permission', method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', 'x-worklings-desk': token } });
    req.on('error', () => {});
    req.end(JSON.stringify(permissionPayload));
    await vi.waitFor(() => expect(h.f.classified).toHaveLength(1));
    expect(company.approvalsAsked).toEqual([]);
    req.destroy();
  });

  it('withdraws the approval from the inbox when Claude Code stops waiting for it', async () => {
    const { h, company, token } = await desk();
    h.f.verdict.next = { verdict: 'ask', kind: 'deploy', summary: 'Deploy the site', detail: 'npm run deploy', alwaysRule: null };
    const req = request({ host: '127.0.0.1', port: h.port, path: '/desk/permission', method: 'POST', headers: { ...local(h.port), 'content-type': 'application/json', 'x-worklings-desk': token } });
    req.on('error', () => {});
    req.end(JSON.stringify(permissionPayload));
    await vi.waitFor(() => expect(company.approvalsAsked).toHaveLength(1));
    expect(company.approvalsAsked[0]?.signal?.aborted).toBe(false);
    req.destroy();
    await vi.waitFor(() => expect(company.approvalsAsked[0]?.signal?.aborted).toBe(true));
  });

  it("says no when nobody answers in time, when the policy refuses, and when it can't be asked", async () => {
    const c = await withCompany({ approvalWaitMs: 50 });
    const token = c.h.f.switchboards[0]?.hub.issue('ux-designer') ?? '';
    const ask = () => raw(c.h.port, '/desk/permission', { method: 'POST', headers: { ...local(c.h.port), 'content-type': 'application/json', 'x-worklings-desk': token }, body: JSON.stringify(permissionPayload) });
    const denied = (r: { body: string }) => (json(r).hookSpecificOutput as { decision: { behavior: string; message?: string } }).decision;
    c.h.f.verdict.next = { verdict: 'ask', kind: 'deploy', summary: 'Deploy the site', detail: 'npm run deploy', alwaysRule: null };
    expect(denied(await ask())).toEqual({ behavior: 'deny', message: expect.stringMatching(/^Nobody answered this request in time, so it counts as a no\./) });
    c.h.f.verdict.next = { verdict: 'deny', message: 'Desks never touch .worklings.' };
    expect(denied(await ask())).toEqual({ behavior: 'deny', message: 'Desks never touch .worklings.' });
    c.h.f.verdict.throws = true;
    expect(denied(await ask())).toEqual({ behavior: 'deny', message: expect.stringMatching(/^The office couldn't put this request to the stakeholder/) });
    expect((await raw(c.h.port, '/desk/permission', { method: 'POST', headers: { ...local(c.h.port), 'content-type': 'application/json', 'x-worklings-desk': token }, body: '{"hook_event_name":"Stop"}' })).status).toBe(400);
  });
});

describe('guards', () => {
  it('serves the web app for / and /c/<id> with the strict CSP, and keeps data behind the token and the origin', async () => {
    const web = writeTree(tempDir(), { 'index.html': '<!doctype html><title>Office</title>', 'assets/app.js': 'console.log(1)' });
    const { h, id } = await withCompany({ webDir: web });
    for (const path of ['/', `/c/${id}`, `/c/${id}/inbox`, '/new']) {
      const page = await raw(h.port, path, { headers: local(h.port) });
      expect([page.status, page.body]).toEqual([200, '<!doctype html><title>Office</title>']);
      expect(page.headers['content-security-policy']).toContain("default-src 'self'; script-src 'self' 'wasm-unsafe-eval';");
    }
    expect((await raw(h.port, '/api/lobby', { headers: local(h.port) })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${h.port}/events/lobby`)).status).toBe(401);
    expect((await get(h.port, '/api/lobby', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await get(h.port, '/api/lobby', { host: 'attacker.example' })).status).toBe(403);
    expect((await get(h.port, '/api/lobby', { host: `localhost:${h.port}`, origin: `http://localhost:${h.port}` })).status).toBe(200);
    expect(json(await get(h.port, '/api/c/nope/state'))).toEqual({ error: "That company isn't in the lobby any more.", code: 'gone' });
  });

  it('browses folders only for this machine', async () => {
    const h = await hub();
    const parent = realpathSync.native(writeTree(tempDir(), { 'shop/': '', 'notes.txt': 'hi' }));
    const listing = await get(h.port, `/api/folders?path=${encodeURIComponent(parent)}`);
    expect([listing.status, json(listing).folders]).toEqual([200, ['shop']]);
    const made = await post(h.port, '/api/folders', { parent, name: 'cafe' });
    expect([made.status, json(made)]).toEqual([201, { path: join(parent, 'cafe') }]);
    const forwarded = await get(h.port, `/api/folders?path=${encodeURIComponent(parent)}`, { 'x-forwarded-for': '100.64.0.7' });
    expect([forwarded.status, json(forwarded)]).toEqual([403, { error: "Browse works on the computer running Worklings; type the folder's path here.", code: 'local-only' }]);
  });

  it('notes uncommitted changes for the folder the person chose, and runs no git for a level browsed through', async () => {
    const env = gitEnv();
    const h = await hub({ env });
    const repo = realpathSync.native(writeTree(tempDir(), { 'notes.txt': 'hi' }));
    execFileSync(findGit(env) ?? 'git', ['init', '-q'], { cwd: repo, env });
    const notes = async (query: string) => json(await get(h.port, `/api/folders?path=${encodeURIComponent(repo)}${query}`)).notes;
    expect(await notes('&chosen=1')).toContain('It has uncommitted changes; the company leaves them be.');
    expect(await notes('')).not.toContain('It has uncommitted changes; the company leaves them be.');
  });
});

describe('--tailnet', () => {
  it('serves the office from a port of its own, to the tailnet host with the token, with no intake or folders', async () => {
    const { h, id } = await withCompany({ tailnet: true });
    const port = h.tailnetPort ?? 0;
    expect([port > 0, port !== h.port, h.f.tailnet.started, h.tailnetUrl]).toEqual([true, true, [port], 'https://box.tail1234.ts.net/']);
    // The preview ports it serves are written down in this hub's own folder, as the home it was given says.
    expect(h.f.tailnet.ledgers).toEqual([join(h.home, '.worklings', 'tailnet.json')]);
    const phone = (path: string, headers: Record<string, string> = {}, init: { method?: string; body?: string } = {}) =>
      raw(port, path, { ...init, headers: { host: 'box.tail1234.ts.net', 'x-forwarded-for': '100.64.0.7', ...headers } });
    expect((await phone('/api/lobby', { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await phone('/api/lobby', { authorization: `Bearer ${TOKEN}`, host: 'box.tail1234.ts.net:443' })).status).toBe(200);
    expect((await phone('/api/lobby')).status).toBe(401);
    const say = (origin: string) =>
      phone(`/api/c/${id}/messages`, { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', origin }, { method: 'POST', body: JSON.stringify({ to: 'ux-designer', text: 'From the phone' }) });
    expect((await say('https://box.tail1234.ts.net')).status).toBe(202);
    expect((await say('http://box.tail1234.ts.net')).status).toBe(403);
    // Tailscale passes the phone's own Host through: the tailnet's port has nothing for one that says 127.0.0.1.
    expect(json(await phone('/api/lobby', { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1' })).code).toBe('host');
    for (const path of ['/hooks', '/otel/v1/logs', '/mcp', '/desk/permission', '/desk/hook']) {
      expect((await phone(path, { 'content-type': 'application/json' }, { method: 'POST', body: '{}' })).status).toBe(404);
    }
    expect(json(await phone(`/api/folders?path=${encodeURIComponent(tempDir())}`, { authorization: `Bearer ${TOKEN}` })).code).toBe('local-only');
    expect((await get(h.port, '/api/lobby', { host: 'box.tail1234.ts.net' })).status).toBe(403);
    await h.close();
    expect(h.f.tailnet.stopped).toBe(1);
  });
});
