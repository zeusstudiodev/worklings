// The org tools' transport: the requests Claude Code 2.1.312 really sent (test/fixtures/claude-2.1.312/mcp/) replayed
// against the handler, both MCP revisions, the desk token, and the answers to malformed requests.
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CompanyApi,
  type CompanyView,
  type Message,
  OrgRefusal,
  type Person,
  peopleOf,
  personById,
  type Question,
  STAKEHOLDER,
  type StatusLine,
  toolsFor,
} from '../src/core/company.ts';
import type { Studio, StudioRole } from '../src/core/studio.ts';
import { BODY_LIMIT, LEGACY, MAX_SESSIONS, MODERN, type OrgDesk, orgToolsHandler } from '../src/orgtools/index.ts';

const FIXTURES = new URL('./fixtures/claude-2.1.312/mcp/', import.meta.url);
type Json = Record<string, unknown>;
interface Recorded {
  desk: string | null;
  request: { method: string; path: string; headers: Record<string, string>; body: Json | null };
  response: { status: number; headers: Record<string, string>; body: Json | null } | null;
}
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Json => {
  if (!isObj(v)) throw new Error(`expected an object, got ${JSON.stringify(v)}`);
  return v;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`expected a list, got ${JSON.stringify(v)}`);
  return v;
};

const role = (id: string, department: string, title: string, extra: Partial<StudioRole> = {}): StudioRole => ({ id, department, title, ...extra });
const STUDIO: Studio = {
  version: 1,
  name: 'Pickup Café',
  domain: 'website',
  rigor: 'standard',
  departments: [
    { id: 'direction', name: 'Direction', style: 'direction' },
    { id: 'design', name: 'Design', style: 'design' },
    { id: 'engineering', name: 'Engineering', style: 'engineering' },
  ],
  roles: [
    role('ceo', 'direction', 'CEO', { name: 'Noor' }),
    role('head-of-design', 'design', 'Head of design', { name: 'Ada', level: 'head', reportsTo: 'ceo' }),
    role('ui-designer', 'design', 'UI designer', { name: 'Kai', reportsTo: 'head-of-design' }),
    role('ux-designer', 'design', 'UX designer', { name: 'Lea', reportsTo: 'head-of-design' }),
    role('head-of-engineering', 'engineering', 'Head of engineering', { name: 'Ben', level: 'head', reportsTo: 'ceo' }),
    role('frontend-engineer', 'engineering', 'Frontend engineer', { name: 'Sam', reportsTo: 'head-of-engineering' }),
  ],
  rules: [],
  gates: [],
  skills: [],
  fired: [],
};

/** The calls a desk's tools make of its company, and nothing else: the transport tests need only these. */
class Company implements CompanyApi {
  readonly id: string;
  readonly calls: { method: string; by: string; input: unknown }[] = [];
  private readonly staff: Person[] = peopleOf(STUDIO);
  constructor(id = 'pickup-cafe') {
    this.id = id;
  }
  people(): Person[] {
    return this.staff;
  }
  view(): CompanyView {
    throw new Error('not used here');
  }
  postStatus(by: string, text: string, taskId: string | null): StatusLine {
    this.calls.push({ method: 'postStatus', by, input: { text, taskId } });
    return { person: by, text, taskId, at: 1 };
  }
  report(by: string, input: Parameters<CompanyApi['report']>[1]) {
    this.calls.push({ method: 'report', by, input });
    return { id: 'r-1', person: by, to: personById(this.staff, by)?.reportsTo ?? STAKEHOLDER, at: 1, ...input };
  }
  message(by: string, to: string, text: string): Message {
    this.calls.push({ method: 'message', by, input: { to, text } });
    return { id: 'm-1', from: by, to, text, origin: null, relayOf: null, note: null, at: 1, deliveredAt: null, interrupt: false };
  }
  ask(): Question | Message {
    throw new OrgRefusal('busy', 'Not in these tests.');
  }
  tasks() {
    return [];
  }
  shareScreenshot(): never {
    throw new Error('not used here');
  }
  assign(): never {
    throw new Error('not used here');
  }
  relay(): never {
    throw new Error('not used here');
  }
  review(): never {
    throw new Error('not used here');
  }
  libraryCatalogue() {
    return [];
  }
  proposeOrg(): never {
    throw new Error('not used here');
  }
  askStakeholder(): never {
    throw new Error('not used here');
  }
  askScoping(): never {
    throw new Error('not used here');
  }
  setGoal(): never {
    throw new Error('not used here');
  }
  publishDashboard(): never {
    throw new Error('not used here');
  }
  removeDashboard(): never {
    throw new Error('not used here');
  }
  hire(): never {
    throw new Error('not used here');
  }
  fire(): never {
    throw new Error('not used here');
  }
  move(): never {
    throw new Error('not used here');
  }
  rehire(): never {
    throw new Error('not used here');
  }
  changeOffice(): never {
    throw new Error('not used here');
  }
  say(): never {
    throw new Error('not used here');
  }
  unsend(): never {
    throw new Error('not used here');
  }
  stop(): never {
    throw new Error('not used here');
  }
  answer(): never {
    throw new Error('not used here');
  }
  decide(): never {
    throw new Error('not used here');
  }
  undo(): never {
    throw new Error('not used here');
  }
  answerWithPicks(): never {
    throw new Error('not used here');
  }
  editProposal(): never {
    throw new Error('not used here');
  }
  restoreProposal(): never {
    throw new Error('not used here');
  }
  start(): void {}
  pause(): void {}
  resume(): void {}
  handOver(): never {
    throw new Error('not used here');
  }
  bringBack(): never {
    throw new Error('not used here');
  }
  updateSettings(): never {
    throw new Error('not used here');
  }
  setPreset(): never {
    throw new Error('not used here');
  }
  setBudget(): never {
    throw new Error('not used here');
  }
  setModels(): never {
    throw new Error('not used here');
  }
  markSeen(): void {}
  markLooked(): void {}
}

const tokenOf = (person: string) => `desk-${person}-0123456789abcdefghij`;

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The test server has no port.');
  return address.port;
}

interface Rig {
  port: number;
  company: Company;
  logs: string[];
}
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** The handler mounted the way the hub mounts it: /mcp goes to it, every other path (the OAuth probes) is 404. */
async function rig(company = new Company()): Promise<Rig> {
  const desks = new Map<string, OrgDesk>(company.people().map((p) => [tokenOf(p.id), { company, person: p.id, root: '/project', cwd: '/project' }]));
  const logs: string[] = [];
  const handler = orgToolsHandler({ resolve: (token) => desks.get(token) ?? null, log: (line) => logs.push(line) });
  const server = createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found."}');
      return;
    }
    void handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { port: portOf(server), company, logs };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: Json | null;
}

/**
 * A raw request, so a test sets every header (Host, Origin, Authorization) and the body exactly. `chunks` streams the
 * body without a length and stops once the answer starts; `noBody` sends the headers alone, so a server that waited for
 * the body would never answer.
 */
function send(port: number, init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer; chunks?: Buffer[]; noBody?: true }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = request({ host: '127.0.0.1', port, path: init.path ?? '/mcp', method: init.method ?? 'POST', headers: init.headers ?? {} }, (res) => {
      answered = true;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Json | null;
        try {
          const parsed: unknown = text ? JSON.parse(text) : null;
          json = isObj(parsed) ? parsed : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        if (init.noBody || init.chunks) req.destroy();
      });
    });
    // Once the answer is in, a server that closed the connection under an upload it didn't read is no error.
    req.on('error', (error) => {
      if (!answered) reject(error);
    });
    if (init.noBody) {
      req.flushHeaders();
      return;
    }
    if (init.chunks) {
      const chunks = init.chunks;
      void (async () => {
        for (const chunk of chunks) {
          if (answered) return;
          if (!req.write(chunk)) await once(req, 'drain');
        }
        req.end();
      })().catch(() => undefined);
      return;
    }
    req.end(init.body);
  });
}

const META = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'claude-code', version: '2.1.312' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
const modernHeaders = (port: number, person: string, method: string, extra: Record<string, string> = {}) => ({
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${tokenOf(person)}`,
  'content-type': 'application/json',
  'mcp-method': method,
  'mcp-protocol-version': MODERN,
  host: `127.0.0.1:${port}`,
  ...extra,
});
/** A request on 2026-07-28, as Claude Code sends one. */
function modern(port: number, person: string, method: string, params: Json = {}, extra: Record<string, string> = {}, id: string | number = 1) {
  const name: Record<string, string> = method === 'tools/call' && typeof params.name === 'string' ? { 'mcp-name': params.name } : {};
  return send(port, { headers: modernHeaders(port, person, method, { ...name, ...extra }), body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: META } }) });
}
/** A request on the 2025-11-25 handshake. */
function legacy(port: number, person: string, body: Json, session?: string) {
  return send(port, {
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokenOf(person)}`,
      'content-type': 'application/json',
      host: `127.0.0.1:${port}`,
      ...(session === undefined ? {} : { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
  });
}
async function openSession(port: number, person: string): Promise<string> {
  const reply = await legacy(port, person, { id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.312' } } });
  const id = reply.headers['mcp-session-id'];
  if (typeof id !== 'string') throw new Error(`initialize gave no session: ${reply.text}`);
  return id;
}

const result = (reply: Reply): Json => obj(reply.json?.result);
const errorOf = (reply: Reply): Json => obj(reply.json?.error);

/** What Claude Code needs of a listed tool: a name the API takes once prefixed, a description, an object schema. */
function expectUsableTool(tool: unknown) {
  const t = obj(tool);
  expect(typeof t.name === 'string' && /^[a-z_]+$/.test(t.name) && `mcp__org__${t.name}`.length <= 64).toBe(true);
  expect(typeof t.description === 'string' && t.description.length > 20).toBe(true);
  const schema = obj(t.inputSchema);
  expect(schema.type).toBe('object');
  expect(schema.additionalProperties).toBe(false);
  const properties = obj(schema.properties);
  for (const name of list(schema.required ?? [])) expect(Object.hasOwn(properties, String(name))).toBe(true);
  for (const field of Object.values(properties)) expect(typeof obj(field).description).toBe('string');
}

/** Replaces the fixture's placeholders: each recorded desk is one of this org's people. */
function replayHeaders(entry: Recorded, port: number, desks: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(entry.request.headers)) {
    headers[name] = value.replace('<org port>', String(port)).replace(/<desk token: (\w+)>/, (_m, desk: string) => tokenOf(desks[desk] ?? 'nobody'));
  }
  return headers;
}

describe('the requests Claude Code 2.1.312 sent', () => {
  it('answers the 2026-07-28 exchange of two desks the way Claude Code took it', async () => {
    const { port, company } = await rig();
    const desks = { ada: 'ui-designer', lin: 'ux-designer' };
    const recorded = fixture('modern-exchange.json') as Recorded[];
    expect(recorded.map((e) => e.request.body?.method)).toEqual(['server/discover', 'tools/list', 'server/discover', 'tools/list', 'tools/call', 'tools/call']);
    for (const entry of recorded) {
      const reply = await send(port, { method: entry.request.method, headers: replayHeaders(entry, port, desks), body: JSON.stringify(entry.request.body) });
      const before = obj(entry.response?.body);
      expect(reply.status).toBe(entry.response?.status);
      expect(reply.json?.jsonrpc).toBe('2.0');
      expect(reply.json?.id).toBe(before.id);
      // Everything Claude Code got from the proof's server, it gets here too.
      const mine = result(reply);
      for (const key of Object.keys(obj(before.result))) expect(Object.hasOwn(mine, key)).toBe(true);
      expect(mine.resultType).toBe('complete');
      expect(obj(obj(mine._meta)['io.modelcontextprotocol/serverInfo'])).toMatchObject({ name: 'org', version: expect.any(String) });
      const person = desks[entry.desk as keyof typeof desks];
      const method = entry.request.body?.method;
      if (method === 'server/discover') {
        expect(mine.supportedVersions).toEqual([MODERN]);
        expect(obj(obj(mine.capabilities).tools)).toEqual({});
        // Since v0.2 the office posts "Started ..." itself, so the instructions no longer ask a desk for status lines.
        expect(String(mine.instructions)).toContain('Report to your manager with report');
        expect(String(mine.instructions)).not.toMatch(/status line|post_status/i);
      }
      if (method === 'tools/list') {
        const tools = list(mine.tools);
        tools.forEach(expectUsableTool);
        const me = personById(company.people(), person);
        expect(tools.map((t) => obj(t).name)).toEqual(me ? toolsFor(me) : []);
      }
      if (method === 'tools/call') expect(mine).toMatchObject({ isError: false, content: [{ type: 'text', text: expect.any(String) }] });
    }
    // The two calls reached the company as the two desks' people, with what the models wrote.
    expect(company.calls).toEqual([
      { method: 'report', by: 'ux-designer', input: { taskId: null, outcome: 'done', text: 'Checked the org tools; nothing to fix.' } },
      { method: 'postStatus', by: 'ui-designer', input: { text: 'Reading the brief for the org tools check.', taskId: null } },
    ]);
  });

  it('answers the 2025-11-25 handshake on a session of its own', async () => {
    const { port } = await rig();
    const recorded = fixture('legacy-exchange.json') as Recorded[];
    let session = '';
    for (const entry of recorded) {
      const headers = replayHeaders(entry, port, { pia: 'frontend-engineer' });
      if (headers['mcp-session-id']) headers['mcp-session-id'] = session;
      const reply = await send(port, { method: entry.request.method, headers, ...(entry.request.body ? { body: JSON.stringify(entry.request.body) } : {}) });
      expect(reply.status).toBe(entry.response?.status);
      const method = entry.request.body?.method;
      if (method === 'initialize') {
        session = String(reply.headers['mcp-session-id']);
        expect(session).toMatch(/^[0-9a-f-]{36}$/);
        expect(result(reply)).toMatchObject({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'org' }, instructions: expect.any(String) });
      } else if (method === 'tools/list') {
        const tools = list(result(reply).tools);
        tools.forEach(expectUsableTool);
        expect(tools.map((t) => obj(t).name)).toEqual(['post_status', 'report', 'message', 'ask', 'org', 'tasks', 'share_screenshot', 'stakeholder_words']);
      } else {
        // notifications/initialized: 202; the GET for a server stream: 405, as the hub answers it too.
        expect(reply.text).toBe('');
        if (entry.request.method === 'GET') expect(reply.headers.allow).toBe('POST, DELETE');
      }
    }
  });

  it('refuses the recorded requests without a token, or with a wrong one, with a bare 401', async () => {
    const { port, company } = await rig();
    const recorded = fixture('unauthorized-exchange.json') as { noToken: Recorded[]; wrongToken: Recorded[] };
    const discover = JSON.stringify({ jsonrpc: '2.0', id: 'server-discover-probe-1', method: 'server/discover', params: { _meta: META } });
    for (const entry of [...recorded.noToken, ...recorded.wrongToken]) {
      const headers = replayHeaders(entry, port, {});
      if (headers.authorization) headers.authorization = 'Bearer wrong-token-0123456789abcdefghij';
      const reply = await send(port, { method: entry.request.method, path: entry.request.path, headers, ...(entry.request.method === 'POST' ? { body: discover } : {}) });
      expect(reply.status).toBe(entry.response?.status);
      if (entry.request.path === '/mcp') {
        expect(reply.headers['www-authenticate']).toBe(entry.response?.headers['www-authenticate']);
        expect(reply.text).toBe('');
      }
    }
    expect(company.calls).toEqual([]);
  });
});

describe('the desk token', () => {
  it('ties every request to its desk, so two desks at once see their own tools', async () => {
    const { port, company } = await rig();
    const [ceo, worker] = await Promise.all([modern(port, 'ceo', 'tools/list'), modern(port, 'ui-designer', 'tools/list')]);
    const theCeo = personById(company.people(), 'ceo');
    expect(list(result(ceo).tools).map((t) => obj(t).name)).toEqual(theCeo ? toolsFor(theCeo) : []);
    expect(list(result(worker).tools).map((t) => obj(t).name)).not.toContain('hire');
  });

  it('answers 401 with no detail for a missing token, another scheme and an unknown token', async () => {
    const { port } = await rig();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } });
    for (const authorization of [undefined, 'Basic dXNlcjpwYXNz', 'Bearer', `Bearer ${tokenOf('ceo')} extra`, 'Bearer desk-nobody-0123456789abcdefghij']) {
      const headers: Record<string, string> = { ...modernHeaders(port, 'ceo', 'tools/list') };
      if (authorization === undefined) delete headers.authorization;
      else headers.authorization = authorization;
      const reply = await send(port, { headers, body });
      expect(reply.status).toBe(401);
      expect(reply.text).toBe('');
      expect(reply.headers['www-authenticate']).toBe(authorization === undefined ? 'Bearer realm="worklings-org"' : 'Bearer realm="worklings-org", error="invalid_token"');
    }
  });

  it('answers 401 before reading the body', async () => {
    const { port } = await rig();
    const headers = { ...modernHeaders(port, 'ceo', 'tools/list'), authorization: 'Bearer wrong-token-0123456789abcdefghij', 'content-length': String(BODY_LIMIT * 2) };
    const reply = await send(port, { headers, noBody: true });
    expect([reply.status, reply.text]).toEqual([401, '']);
  });

  it('refuses a request a browser sends, whatever its token', async () => {
    const { port, company } = await rig();
    const reply = await modern(port, 'ceo', 'tools/list', {}, { origin: 'http://evil.example' });
    expect(reply.status).toBe(403);
    expect(company.calls).toEqual([]);
  });
});

describe('2026-07-28, stateless', () => {
  it('lists the tools, takes a call and a ping with no session', async () => {
    const { port, company } = await rig();
    expect(result(await modern(port, 'ui-designer', 'ping'))).toMatchObject({ resultType: 'complete' });
    const call = await modern(port, 'ui-designer', 'tools/call', { name: 'post_status', arguments: { text: 'Starting the palette.' } });
    expect(call.headers['mcp-session-id']).toBeUndefined();
    expect(result(call)).toMatchObject({ isError: false, content: [{ type: 'text', text: 'Posted on the Now board.' }] });
    expect(company.calls).toHaveLength(1);
  });

  it('refuses headers that disagree with the body', async () => {
    const { port } = await rig();
    const versionOff = await send(port, {
      headers: modernHeaders(port, 'ceo', 'tools/list'),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } }),
    });
    expect([versionOff.status, errorOf(versionOff).code]).toEqual([400, -32020]);
    const methodOff = await modern(port, 'ceo', 'tools/list', {}, { 'mcp-method': 'tools/call' });
    expect([methodOff.status, errorOf(methodOff).code]).toEqual([400, -32020]);
    const nameOff = await modern(port, 'ceo', 'tools/call', { name: 'post_status', arguments: { text: 'Hi.' } }, { 'mcp-name': 'hire' });
    expect([nameOff.status, errorOf(nameOff).code]).toEqual([400, -32020]);
  });

  it('takes a tool name sent Base64-encoded in Mcp-Name', async () => {
    const { port } = await rig();
    const encoded = `=?base64?${Buffer.from('post_status').toString('base64')}?=`;
    const reply = await modern(port, 'ceo', 'tools/call', { name: 'post_status', arguments: { text: 'Drafting the org.' } }, { 'mcp-name': encoded });
    expect(result(reply).isError).toBe(false);
  });

  it('names the versions it speaks when asked for one it does not', async () => {
    const { port } = await rig();
    const reply = await send(port, {
      headers: { ...modernHeaders(port, 'ceo', 'server/discover'), 'mcp-protocol-version': '2027-01-01' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' } } }),
    });
    expect(reply.status).toBe(400);
    expect(errorOf(reply)).toMatchObject({ code: -32022, data: { supported: [MODERN, ...LEGACY], requested: '2027-01-01' } });
  });

  it('accepts notifications and answers nothing', async () => {
    const { port } = await rig();
    const reply = await send(port, { headers: modernHeaders(port, 'ceo', 'notifications/cancelled'), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }) });
    expect([reply.status, reply.text]).toEqual([202, '']);
  });
});

describe('the 2025-11-25 handshake', () => {
  it('serves calls on the session it issued', async () => {
    const { port } = await rig();
    const session = await openSession(port, 'ui-designer');
    const reply = await legacy(port, 'ui-designer', { id: 2, method: 'tools/call', params: { name: 'post_status', arguments: { text: 'Picking colours.' } } }, session);
    expect(result(reply)).toEqual({ content: [{ type: 'text', text: 'Posted on the Now board.' }], isError: false });
  });

  it("keeps a session to the desk that opened it: another desk's token gets 404", async () => {
    const { port } = await rig();
    const session = await openSession(port, 'ui-designer');
    const other = await legacy(port, 'ux-designer', { id: 2, method: 'tools/list' }, session);
    expect(other.status).toBe(404);
    expect((await legacy(port, 'ui-designer', { id: 3, method: 'tools/list' }, session)).status).toBe(200);
  });

  it('refuses an unknown session, a session on another version and a call with neither', async () => {
    const { port } = await rig();
    expect((await legacy(port, 'ceo', { id: 1, method: 'tools/list' }, 'no-such-session')).status).toBe(404);
    const session = await openSession(port, 'ceo');
    const wrongVersion = await send(port, {
      headers: { authorization: `Bearer ${tokenOf('ceo')}`, 'content-type': 'application/json', 'mcp-session-id': session, 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(wrongVersion.status).toBe(400);
    const neither = await send(port, { headers: { authorization: `Bearer ${tokenOf('ceo')}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(neither.status).toBe(400);
    expect(String(errorOf(neither).message)).toContain('initialize');
  });

  it('agrees an older revision when the client asks for one, and its own newest otherwise', async () => {
    const { port } = await rig();
    const older = await legacy(port, 'ceo', { id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    expect(result(older).protocolVersion).toBe('2025-03-26');
    const future = await legacy(port, 'ceo', { id: 0, method: 'initialize', params: { protocolVersion: '2030-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    expect(result(future).protocolVersion).toBe('2025-11-25');
  });

  it('ends a session on DELETE', async () => {
    const { port } = await rig();
    const session = await openSession(port, 'ceo');
    const auth = { authorization: `Bearer ${tokenOf('ceo')}`, 'mcp-session-id': session };
    expect((await send(port, { method: 'DELETE', headers: { ...auth, authorization: `Bearer ${tokenOf('ui-designer')}` } })).status).toBe(404);
    expect((await send(port, { method: 'DELETE', headers: auth })).status).toBe(204);
    expect((await legacy(port, 'ceo', { id: 1, method: 'tools/list' }, session)).status).toBe(404);
  });

  it(`keeps at most ${MAX_SESSIONS} sessions, dropping the oldest`, async () => {
    const { port } = await rig();
    const first = await openSession(port, 'ceo');
    const second = await openSession(port, 'ceo');
    for (let i = 0; i < MAX_SESSIONS - 1; i += 1) await openSession(port, 'ui-designer');
    expect((await legacy(port, 'ceo', { id: 1, method: 'ping' }, first)).status).toBe(404);
    expect((await legacy(port, 'ceo', { id: 1, method: 'ping' }, second)).status).toBe(200);
  });
});

describe('malformed requests', () => {
  const headers = (port: number) => modernHeaders(port, 'ceo', 'tools/list');

  it('answers a body that is not JSON, or not UTF-8, with a parse error', async () => {
    const { port } = await rig();
    for (const body of ['{"jsonrpc": "2.0",', Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])]) {
      const reply = await send(port, { headers: headers(port), body });
      expect([reply.status, errorOf(reply).code]).toEqual([400, -32700]);
    }
  });

  it('answers a batch, a message without jsonrpc and a bad id as invalid requests', async () => {
    const { port } = await rig();
    for (const message of [[{ jsonrpc: '2.0', id: 1, method: 'tools/list' }], { id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: { x: 1 }, method: 'tools/list' }, { jsonrpc: '2.0', id: 1, method: 7 }]) {
      const reply = await send(port, { headers: headers(port), body: JSON.stringify(message) });
      expect([reply.status, errorOf(reply).code]).toEqual([400, -32600]);
    }
  });

  it('answers the wrong content type with 415 and an Accept without JSON with 406', async () => {
    const { port } = await rig();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } });
    expect((await send(port, { headers: { ...headers(port), 'content-type': 'text/plain' }, body })).status).toBe(415);
    expect((await send(port, { headers: { ...headers(port), accept: 'text/event-stream' }, body })).status).toBe(406);
  });

  it('answers a body that says it is over 1 MB with 413 and a JSON-RPC error, before reading it', async () => {
    const { port, company } = await rig();
    const headers = { ...modernHeaders(port, 'ceo', 'tools/call'), 'mcp-name': 'post_status', 'content-length': String(BODY_LIMIT + 1) };
    const reply = await send(port, { headers, noBody: true });
    expect([reply.status, errorOf(reply).code]).toEqual([413, -32600]);
    expect(company.calls).toEqual([]);
  });

  it('gets the 413 to a client still uploading the body, instead of resetting the connection', async () => {
    const { port, company } = await rig();
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post_status', arguments: { text: 'x'.repeat(BODY_LIMIT) }, _meta: META } });
    const reply = await send(port, { headers: { ...modernHeaders(port, 'ceo', 'tools/call'), 'mcp-name': 'post_status' }, body: big });
    expect([reply.status, errorOf(reply).code]).toEqual([413, -32600]);
    expect(company.calls).toEqual([]);
  });

  it('answers a body that grows past 1 MB without a length with 413', async () => {
    const { port, company } = await rig();
    const reply = await send(port, { headers: { ...headers(port), 'transfer-encoding': 'chunked' }, chunks: Array.from({ length: 24 }, () => Buffer.alloc(64 * 1024, 0x20)) });
    expect([reply.status, errorOf(reply).code]).toEqual([413, -32600]);
    expect(company.calls).toEqual([]);
  });

  it('answers an unknown method, an unknown tool and arguments that are not an object as JSON-RPC errors', async () => {
    const { port } = await rig();
    expect(errorOf(await modern(port, 'ceo', 'resources/list')).code).toBe(-32601);
    const session = await openSession(port, 'ceo');
    expect(errorOf(await legacy(port, 'ceo', { id: 1, method: 'prompts/list' }, session)).code).toBe(-32601);
    const unknown = await modern(port, 'ceo', 'tools/call', { name: 'delete_everything', arguments: {} });
    expect([unknown.status, errorOf(unknown).code]).toEqual([200, -32602]);
    expect(errorOf(await modern(port, 'ceo', 'tools/call', { name: 'post_status', arguments: ['Hello.'] })).code).toBe(-32602);
  });

  it('takes a JSON-RPC response from the client and does nothing with it', async () => {
    const { port } = await rig();
    const reply = await send(port, { headers: headers(port), body: JSON.stringify({ jsonrpc: '2.0', id: 4, result: {} }) });
    expect([reply.status, reply.text]).toEqual([202, '']);
  });

  it('answers a GET with 405, as there is no server stream', async () => {
    const { port } = await rig();
    const reply = await send(port, { method: 'GET', headers: { authorization: `Bearer ${tokenOf('ceo')}`, accept: 'text/event-stream' } });
    expect([reply.status, reply.headers.allow]).toEqual([405, 'POST, DELETE']);
  });

  it('answers 500 and logs the cause when the hub fails to say whose desk it is', async () => {
    const logs: string[] = [];
    const handler = orgToolsHandler({
      resolve: () => {
        throw new Error('token table unavailable');
      },
      log: (line) => logs.push(line),
    });
    const server = createServer((req, res) => void handler(req, res));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = portOf(server);
    const reply = await modern(port, 'ceo', 'tools/list');
    expect([reply.status, errorOf(reply).code]).toEqual([500, -32603]);
    expect(logs.join('\n')).toContain('token table unavailable');
    expect(logs.join('\n')).not.toContain(tokenOf('ceo'));
  });
});
