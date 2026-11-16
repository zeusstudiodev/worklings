// Proves what the org tools rely on, against the real Claude Code: an MCP server that Worklings serves itself over the
// Streamable HTTP transport on 127.0.0.1, reached from `claude -p --mcp-config` with a token per desk. It records which
// protocol Claude Code speaks to it (2026-07-28, stateless, or the 2025-11-25 handshake it falls back to); that a tool
// call arrives with the desk's token and its arguments and that the tool's answer reaches the model; what Claude Code
// does when the token is missing or wrong (401); that an MCP tool call needs approval in -p mode, and that an allow
// rule runs the org tools without the PermissionRequest hook while the person's own settings and connectors still
// load; and that one server tells two desks working at once apart by their tokens.
//
//   node scripts/check-orgtools.mjs [--probe] [--keep]
//
// --probe runs only the checks that need no model: Claude Code connects its MCP servers when it starts, so a
// stream-json session that is never sent a message shows the whole connection for free. The full run adds four Haiku
// sessions (2 to 3 cents on 2.1.312). Like the office, it runs the person's own Claude Code (findClaude) with the
// office's child environment (claudeEnv), here from a neutral temp folder with no session saved; it never reads or
// passes credentials. --keep leaves the neutral folder in place.
//
// Writes test-results/orgtools-check.json and, when every required check passes on a full run, the sanitized fixtures
// in test/fixtures/claude-<version>/mcp/. Run it again when Claude Code changes (see docs/claude-code-surfaces.md).
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { claudeEnv, findClaude } = await import('../src/server/claude.ts');
const { fromThisMachine, isJson } = await import('../src/server/http.ts');
const { freshToken, sameToken } = await import('../src/server/token.ts');

const repo = fileURLToPath(new URL('..', import.meta.url));
const probeOnly = process.argv.includes('--probe');
const keep = process.argv.includes('--keep');
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A timeout to race against: unref'd, so a race that is already won doesn't keep the script alive. */
const deadline = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------------------------------
// The protocol, hand-rolled: the org tools need five methods, so the official SDK (several MB and a dozen dependencies)
// would add more than it saves. The fixtures this script writes pin what Claude Code actually sends.

/** The current MCP revision: stateless, every request carries its version, identity and capabilities in _meta. */
const MODERN = '2026-07-28';
/** The handshake revisions the server also speaks, newest first, for clients that open with `initialize`. */
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'worklings-org', version: '0.0.0-check' };
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;
/** A refused desk token. Application codes stay outside JSON-RPC's reserved range (-32768 to -32000). */
const UNAUTHORIZED = -31001;
const BODY_LIMIT = 64 * 1024;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The port the watched office uses: never listen there. (The e2e suite takes free ports of its own.) */
const TAKEN_PORTS = new Set([7421]);

/** The desk's token reaches Claude Code in its environment and the config names the variable, so no command line shows it. */
const TOKEN_VARIABLE = 'WORKLINGS_DESK_TOKEN';
const TOKEN_HEADER = `Bearer \${${TOKEN_VARIABLE}}`;

const TOOLS = [
  {
    name: 'post_status',
    title: 'Post a status line',
    description:
      'Post one plain sentence about your work when you start, finish, change step or get stuck. The office shows it on the Now board. No tool names or file paths.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 200, description: 'One sentence, as you would say it to a colleague.' } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'report',
    title: 'Report to your manager',
    description: 'Report on your task to your manager: what you did, and whether it is done or blocked. Closes or blocks the task.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', minLength: 1, maxLength: 2000, description: 'What you did, what changed and anything your manager should know.' },
        outcome: { type: 'string', enum: ['done', 'blocked'], description: 'done closes the task; blocked asks your manager for help.' },
      },
      required: ['summary', 'outcome'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];
const TOOL_FIELDS = Object.fromEntries(TOOLS.map((tool) => [tool.name, Object.keys(tool.inputSchema.properties)]));

const makeDesk = (id, name, role, manager) => ({ id, name, role, manager, token: freshToken(), code: `D-${randomBytes(2).toString('hex').toUpperCase()}` });
const desks = [
  makeDesk('ada', 'Ada', 'UI designer', 'Grace'),
  makeDesk('lin', 'Lin', 'copywriter', 'Grace'),
  makeDesk('mo', 'Mo', 'QA engineer', 'Joan'),
  makeDesk('pia', 'Pia', 'runtime engineer', 'Joan'),
];
const desk = (id) => {
  const found = desks.find((d) => d.id === id);
  if (!found) throw new Error(`No desk ${id}`);
  return found;
};
const wrongToken = freshToken();

/** Per desk, so it can name the person; the instructions reach the model's system prompt. */
const instructionsFor = (d) =>
  `Worklings org tools for ${d.name}, ${d.role}, who reports to ${d.manager}. Post a status line with post_status when you start, finish, change step or get stuck; report to ${d.manager} with report when your task is done or blocked. Desk code: ${d.code}.`;
/** The real server lists the tools the person's level allows (assign for heads, hire for the CEO); here everyone has both. */
const toolsFor = () => TOOLS;

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code, message, ...(data === undefined ? {} : { data }) } });

function loopbackHost(host) {
  const value = String(host ?? '');
  const name = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : (value.split(':')[0] ?? '');
  return LOOPBACK.has(name.toLowerCase());
}

/** Mcp-Name and Mcp-Param-* values may come Base64-encoded as =?base64?...?=. */
function headerValue(value) {
  if (typeof value !== 'string') return undefined;
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  return encoded ? Buffer.from(encoded[1] ?? '', 'base64').toString('utf8') : value;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Runs a tool for a desk: a result the model reads, with isError for input it can fix. */
function runTool(d, name, args) {
  const answer = (text, isError = false) => ({ content: [{ type: 'text', text }], isError });
  const unknown = Object.keys(args).filter((key) => !(TOOL_FIELDS[name] ?? []).includes(key));
  if (unknown.length > 0) return answer(`${name} doesn't take ${unknown.join(', ')}.`, true);
  const receipt = `R-${randomBytes(3).toString('hex').toUpperCase()}`;
  if (name === 'post_status') {
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return answer('post_status needs text: one plain sentence about your work.', true);
    if (text.length > 200) return answer('Keep a status line under 200 characters.', true);
    return { ...answer(`Posted for ${d.name}. Receipt ${receipt}.`), receipt };
  }
  const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
  if (!summary) return answer('report needs a summary of what you did.', true);
  if (summary.length > 2000) return answer('Keep a report under 2000 characters.', true);
  if (args.outcome !== 'done' && args.outcome !== 'blocked') return answer('outcome is done or blocked.', true);
  return { ...answer(`Report filed with ${d.manager}; the task is ${args.outcome === 'done' ? 'closed' : 'blocked'}. Receipt ${receipt}.`), receipt };
}

/** The org tools server: one endpoint, many desks, each request tied to a desk by its bearer token. */
function startOrgServer() {
  const t0 = Date.now();
  const exchange = [];
  const calls = [];
  /** Legacy sessions only: id -> the desk that opened it and the revision it speaks. */
  const sessions = new Map();
  const deskOf = (authorization) => {
    const given = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
    return desks.find((d) => sameToken(given, d.token)) ?? null;
  };

  function callTool(d, params, era, entry) {
    const name = params.name;
    const args = params.arguments === undefined ? {} : params.arguments;
    if (typeof name !== 'string' || !Object.hasOwn(TOOL_FIELDS, name)) return { error: [INVALID_PARAMS, `Unknown tool: ${String(name).slice(0, 60)}`] };
    if (!isObject(args)) return { error: [INVALID_PARAMS, 'Invalid params: arguments must be an object.'] };
    const { receipt, ...result } = runTool(d, name, args);
    calls.push({ time: entry.time, desk: d.id, era, tool: name, arguments: args, meta: isObject(params._meta) ? params._meta : null, isError: result.isError, receipt: receipt ?? null, answer: result.content[0]?.text ?? '' });
    return { result };
  }

  function modern(d, msg, req, entry, reply) {
    entry.era = 'modern';
    const isRequest = Object.hasOwn(msg, 'id');
    // 2026-07-28 defines no client notifications over HTTP: accept and ignore any.
    if (!isRequest) return reply(202);
    const id = msg.id;
    const params = isObject(msg.params) ? msg.params : {};
    const meta = isObject(params._meta) ? params._meta : {};
    const version = meta['io.modelcontextprotocol/protocolVersion'];
    if (version !== req.headers['mcp-protocol-version']) return reply(400, rpcError(id, HEADER_MISMATCH, 'Header mismatch: MCP-Protocol-Version differs from the protocolVersion in _meta.'));
    if (version !== MODERN) return reply(400, rpcError(id, UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: [MODERN, ...LEGACY], requested: String(version).slice(0, 40) }));
    if (!isObject(meta['io.modelcontextprotocol/clientCapabilities'])) return reply(400, rpcError(id, INVALID_PARAMS, 'Invalid params: _meta needs io.modelcontextprotocol/clientCapabilities.'));
    // A header that disagrees with the body is refused; one that is missing is noted, so the fixtures show it.
    const method = req.headers['mcp-method'];
    if (method === undefined) entry.missing = [...(entry.missing ?? []), 'mcp-method'];
    else if (method !== msg.method) return reply(400, rpcError(id, HEADER_MISMATCH, 'Header mismatch: Mcp-Method differs from the method in the body.'));
    if (msg.method === 'tools/call') {
      const named = headerValue(req.headers['mcp-name']);
      if (named === undefined) entry.missing = [...(entry.missing ?? []), 'mcp-name'];
      else if (named !== params.name) return reply(400, rpcError(id, HEADER_MISMATCH, 'Header mismatch: Mcp-Name differs from the tool name in the body.'));
    }
    const done = (result) => reply(200, rpcResult(id, { resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO } }));
    switch (msg.method) {
      case 'server/discover':
        return done({ supportedVersions: [MODERN], capabilities: { tools: {} }, instructions: instructionsFor(d) });
      case 'tools/list':
        return done({ tools: toolsFor(d) });
      case 'tools/call': {
        const called = callTool(d, params, 'modern', entry);
        return called.error ? reply(200, rpcError(id, ...called.error)) : done(called.result);
      }
      case 'ping':
        return done({});
      default:
        return reply(404, rpcError(id, METHOD_NOT_FOUND, 'Method not found.'));
    }
  }

  function initialize(d, msg, entry, reply) {
    entry.era = 'legacy';
    if (!Object.hasOwn(msg, 'id')) return reply(400, rpcError(undefined, INVALID_REQUEST, 'initialize is a request: give it an id.'));
    const asked = isObject(msg.params) ? msg.params.protocolVersion : undefined;
    const version = LEGACY.includes(asked) ? asked : LEGACY[0];
    // A session is a name, not a credential: it belongs to the desk whose token opened it.
    const sessionId = randomUUID();
    sessions.set(sessionId, { desk: d.id, version });
    const result = { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: instructionsFor(d) };
    return reply(200, rpcResult(msg.id, result), { 'mcp-session-id': sessionId });
  }

  function legacy(d, msg, sessionId, req, entry, reply) {
    entry.era = 'legacy';
    const isRequest = Object.hasOwn(msg, 'id');
    const id = isRequest ? msg.id : undefined;
    const session = sessions.get(sessionId);
    // Every request must come with the token of the desk that opened the session.
    if (!session || session.desk !== d.id) return reply(404, rpcError(id, INVALID_REQUEST, 'Session not found: start again with initialize.'));
    const version = req.headers['mcp-protocol-version'];
    if (version !== undefined && version !== session.version) return reply(400, rpcError(id, INVALID_REQUEST, `This session speaks ${session.version}.`));
    if (!isRequest) return reply(202);
    const params = isObject(msg.params) ? msg.params : {};
    switch (msg.method) {
      case 'ping':
        return reply(200, rpcResult(id, {}));
      case 'tools/list':
        return reply(200, rpcResult(id, { tools: toolsFor(d) }));
      case 'tools/call': {
        const called = callTool(d, params, 'legacy', entry);
        return reply(200, called.error ? rpcError(id, ...called.error) : rpcResult(id, called.result));
      }
      default:
        return reply(200, rpcError(id, METHOD_NOT_FOUND, 'Method not found.'));
    }
  }

  async function handle(req, entry, reply) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    // The intake guards of src/server/http.ts: from this machine, to a loopback Host, never from a browser.
    if (!fromThisMachine(req.socket.remoteAddress) || !loopbackHost(req.headers.host) || req.headers.origin !== undefined) {
      return reply(403, { error: 'The org tools answer only desks on this computer.' });
    }
    // Only the MCP endpoint exists. OAuth discovery (/.well-known/...) and client registration (/register) end here, so
    // a desk without a token fails at once instead of starting a sign-in.
    if (path !== '/mcp') return reply(404, { error: 'Not found.' });
    const d = deskOf(req.headers.authorization);
    if (!d) {
      const challenge = `Bearer realm="worklings-org"${req.headers.authorization === undefined ? '' : ', error="invalid_token"'}`;
      return reply(401, rpcError(undefined, UNAUTHORIZED, "This desk's token is missing or wrong."), { 'www-authenticate': challenge });
    }
    entry.desk = d.id;
    const sessionId = req.headers['mcp-session-id'];
    if (req.method === 'DELETE') {
      const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (!session || session.desk !== d.id) return reply(404, rpcError(undefined, INVALID_REQUEST, 'Session not found.'));
      sessions.delete(sessionId);
      return reply(204);
    }
    // No server-to-client stream: a legacy client's GET is answered 405, which tells it so.
    if (req.method !== 'POST') return reply(405, undefined, { allow: 'POST, DELETE' });
    if (!isJson(req.headers['content-type'])) return reply(415, rpcError(undefined, INVALID_REQUEST, 'Send one JSON-RPC message as application/json.'));
    if (!/application\/json|\*\/\*/.test(String(req.headers.accept ?? ''))) return reply(406, rpcError(undefined, INVALID_REQUEST, 'Accept application/json.'));
    const raw = await readBody(req);
    if (raw === null) return reply(413, rpcError(undefined, INVALID_REQUEST, 'The message is too large.'));
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return reply(400, rpcError(undefined, PARSE_ERROR, 'Parse error: the body is not JSON.'));
    }
    entry.request.body = msg;
    if (!isObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return reply(400, rpcError(undefined, INVALID_REQUEST, 'Send one JSON-RPC 2.0 message, not a batch.'));
    if (Object.hasOwn(msg, 'id') && typeof msg.id !== 'string' && typeof msg.id !== 'number') return reply(400, rpcError(undefined, INVALID_REQUEST, 'A request id is a string or a number.'));
    entry.rpc = msg.method;
    const version = req.headers['mcp-protocol-version'];
    if (msg.method === 'initialize') return initialize(d, msg, entry, reply);
    if (typeof sessionId === 'string') return legacy(d, msg, sessionId, req, entry, reply);
    if (typeof version === 'string' && !LEGACY.includes(version)) return modern(d, msg, req, entry, reply);
    return reply(400, rpcError(Object.hasOwn(msg, 'id') ? msg.id : undefined, INVALID_REQUEST, `Start with initialize, or send MCP-Protocol-Version: ${MODERN}.`));
  }

  const server = createServer((req, res) => {
    const time = Date.now();
    const entry = { time, at: time - t0, desk: null, era: null, rpc: null, request: { method: req.method ?? '', path: req.url ?? '', headers: { ...req.headers } }, response: null };
    exchange.push(entry);
    const reply = (status, body, headers = {}) => {
      entry.response = { status, headers, body: body ?? null };
      const text = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, { ...(text ? { 'content-type': 'application/json' } : {}), 'cache-control': 'no-store', ...headers });
      res.end(text);
    };
    handle(req, entry, reply).catch((error) => {
      entry.error = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) reply(500, rpcError(undefined, -32603, 'Internal error.'));
    });
  });
  return { server, exchange, calls };
}

/** A stand-in for the office's approval intake: records every hook call and decides nothing. */
function startHookServer() {
  const calls = [];
  const server = createServer((req, res) => {
    if (!fromThisMachine(req.socket.remoteAddress)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (body.length < BODY_LIMIT) body += chunk;
    });
    req.on('end', () => {
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch {
        // not JSON: recorded as null
      }
      calls.push({ time: Date.now(), event: payload?.hook_event_name ?? null, tool: payload?.tool_name ?? null, session: payload?.session_id ?? null, payload });
      // No decision: Claude Code then does what it does when nobody is there to ask.
      res.writeHead(200, { 'content-length': '0' });
      res.end();
    });
  });
  return { server, calls };
}

async function listen(server) {
  for (;;) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const { port } = server.address();
    if (!TAKEN_PORTS.has(port)) return port;
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Running Claude Code

const claude = findClaude();
const NEUTRAL_PREFIX = 'worklings-orgtools-';
const neutral = mkdtempSync(join(tmpdir(), NEUTRAL_PREFIX));
const PROBE_TIMEOUT_MS = 25_000;
const RUN_TIMEOUT_MS = 180_000;

/**
 * The office's child environment (claudeEnv: no CLAUDECODE or host-session wiring) as a desk gets it, plus the desk's
 * token. Desks are long multi-turn sessions, so prompt caching stays on: claudeEnv turns it off for one-shot calls.
 */
function deskEnv(token, extra = {}) {
  const env = { ...claudeEnv(process.env), ...extra };
  delete env.DISABLE_PROMPT_CACHING;
  if (token) env[TOKEN_VARIABLE] = token;
  return env;
}

/** The org server as a desk's --mcp-config names it: always loaded, so its tools are in the first prompt without a search. */
const deskConfig = (port, withToken = true) =>
  JSON.stringify({ mcpServers: { org: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, ...(withToken ? { headers: { Authorization: TOKEN_HEADER } } : {}), alwaysLoad: true } } });

/** The office's PermissionRequest hook, as the switchboard will pass it in --settings. */
const hookSettings = (port, extra = {}) =>
  JSON.stringify({ ...extra, hooks: { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks`, timeout: 10 }] }] } });

/** Kills the process and everything it started: taskkill /T on Windows, the process group elsewhere. */
function killTree(child) {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL'); // the group is already gone: make sure of the process itself
    }
    return Promise.resolve();
  }
  // The full path, so a taskkill.exe in the working folder can't stand in for it.
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise((done) => {
    execFile(taskkill, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 }, (error) => {
      if (error) child.kill();
      done();
    });
  });
}

/** Starts Claude Code in the neutral folder with an argument list, never through a shell. */
function startClaude(args, env) {
  const child = spawn(claude.command, [...claude.prefixArgs, ...args], { cwd: neutral, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
  const out = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (out.stdout.length < 8 * 1024 * 1024) out.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    if (out.stderr.length < 64 * 1024) out.stderr += chunk;
  });
  // It may exit before it reads all of its input; its output says why.
  child.stdin.on('error', () => undefined);
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, out, closed };
}

/** Waits up to `ms` for the run to end, then kills its tree; never waits forever. */
async function finish(run, ms) {
  const ended = await Promise.race([run.closed.then(() => true), deadline(ms).then(() => false)]);
  if (!ended) await killTree(run.child);
  return Promise.race([run.closed, deadline(5_000).then(() => ({ code: null, signal: null, error: 'did not exit after being killed' }))]);
}

function parseLines(stdout) {
  return stdout.split(/\r?\n/).flatMap((line) => {
    if (!line.trim().startsWith('{')) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

const kind = (m) => (m.subtype ? `${m.type}/${m.subtype}` : String(m.type));
const textOf = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : '')).join('\n') : '';

function summarize(messages) {
  const init = messages.find((m) => m.type === 'system' && m.subtype === 'init') ?? null;
  const result = messages.findLast((m) => m.type === 'result') ?? null;
  const content = (role) => messages.filter((m) => m.type === role && isObject(m.message) && Array.isArray(m.message.content)).flatMap((m) => m.message.content);
  const tools = Array.isArray(init?.tools) ? init.tools.filter((t) => typeof t === 'string') : [];
  return {
    sessionId: init?.session_id ?? result?.session_id ?? null,
    init: init && {
      org: Array.isArray(init.mcp_servers) ? (init.mcp_servers.find((s) => s?.name === 'org') ?? null) : null,
      orgTools: tools.filter((t) => t.startsWith('mcp__org__')),
      otherServers: Array.isArray(init.mcp_servers) ? init.mcp_servers.filter((s) => s?.name !== 'org') : [],
      serverErrors: init.mcp_server_errors ?? null,
      permissionMode: init.permissionMode ?? null,
      toolCount: tools.length,
      model: init.model ?? null,
    },
    toolUses: content('assistant').filter((b) => b?.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input })),
    toolResults: content('user').filter((b) => b?.type === 'tool_result').map((b) => ({ toolUseId: b.tool_use_id, isError: b.is_error === true, text: textOf(b.content) })),
    /** Who let each tool call run, as the stream reports it next to the result. */
    decisions: messages.filter((m) => m.type === 'user' && Array.isArray(m.tool_result_meta)).flatMap((m) => m.tool_result_meta.map((t) => ({ toolUseId: t?.id ?? null, decision: t?.permission_decision ?? null }))),
    denials: messages.filter((m) => m.type === 'system' && m.subtype === 'permission_denied').map(({ uuid: _uuid, session_id: _session, ...m }) => m),
    result: result && {
      isError: result.is_error === true,
      subtype: result.subtype ?? null,
      text: typeof result.result === 'string' ? result.result : null,
      costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
      turns: result.num_turns ?? null,
      usage: result.usage ?? null,
      permissionDenials: Array.isArray(result.permission_denials) ? result.permission_denials : [],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks

const org = startOrgServer();
const hooks = startHookServer();
const report = { claudeVersion: null, claude: null, ranAt: new Date().toISOString(), probeOnly, tokenRoute: `${TOKEN_VARIABLE} in the environment, ${TOKEN_HEADER} in --mcp-config`, probes: {}, runs: {}, calls: [], hookCalls: [], checks: [], costUsd: 0, passed: false };
const runs = {};
const probes = {};
let orgPort = 0;
let hookPort = 0;

function check(name, ok, detail, required = true) {
  report.checks.push({ name, ok: Boolean(ok), required, detail: detail ?? null });
  log(ok ? 'ok  ' : required ? 'FAIL' : 'note', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
}

/** Starts a stream-json session, sends it nothing, and stops it once its MCP connection has settled. No model call. */
async function probe(label, env, connected, withToken = true) {
  const from = org.exchange.length;
  const started = Date.now();
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', deskConfig(orgPort, withToken)];
  const run = startClaude(args, env);
  for (;;) {
    await sleep(250);
    const seen = org.exchange.slice(from);
    if (connected && seen.some(connected)) {
      await sleep(1_500); // anything that follows the tool list
      break;
    }
    if (!connected && seen.length > 0 && Date.now() - (seen.at(-1)?.time ?? started) > 4_000) break;
    if (Date.now() - started > PROBE_TIMEOUT_MS) break;
  }
  run.child.stdin.end();
  const exit = await finish(run, 10_000);
  const result = { label, ms: Date.now() - started, exit, exchange: org.exchange.slice(from), stdoutTypes: parseLines(run.out.stdout).map(kind), stderr: run.out.stderr.slice(0, 1_000) };
  probes[label] = result;
  return result;
}

const MODEL_ARGS = ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--permission-mode', 'default', '--max-turns', '6', '--max-budget-usd', '0.25'];

/** One real Haiku session, the prompt on stdin. */
async function modelRun(label, args, env, prompt) {
  const started = Date.now();
  const run = startClaude([...MODEL_ARGS, ...args], env);
  run.child.stdin.end(prompt);
  const exit = await finish(run, RUN_TIMEOUT_MS);
  const ended = Date.now();
  const messages = parseLines(run.out.stdout);
  const result = { label, started, ended, ms: ended - started, exit, messages, ...summarize(messages), stderr: run.out.stderr.slice(0, 2_000) };
  runs[label] = result;
  log(label, `${result.ms} ms`, result.result ? `$${result.result.costUsd}` : 'no result', JSON.stringify(result.result?.text ?? '').slice(0, 160));
  return result;
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().replace(/[.\s]+$/, '').toLowerCase() === b.trim().replace(/[.\s]+$/, '').toLowerCase();
const listed = (e) => e.rpc === 'tools/list' && e.response?.status === 200;

const STATUS_TEXT = 'Reading the brief for the org tools check.';
const REPORT_SUMMARY = 'Checked the org tools; nothing to fix.';
const DENIED_TEXT = 'Starting the approval check.';
const PROMPT_STATUS = `This is a check of the org tools. Do exactly this and nothing else:
1. Call the mcp__org__post_status tool once, with text exactly: ${STATUS_TEXT}
2. Then reply with one line: the receipt the tool returned, then the desk code from the org server's instructions.`;
const PROMPT_REPORT = `This is a check of the org tools. Do exactly this and nothing else:
1. Call the mcp__org__report tool once, with summary exactly: ${REPORT_SUMMARY} and outcome done.
2. Then reply with one line: the receipt the tool returned.`;
const PROMPT_LIST = 'This is a check of the org tools. Use no tools. Reply with one line: the names of the tools you have whose names start with mcp__org__, separated by commas, or the single word NONE if you have none.';
const PROMPT_DENIED = `This is a check of the org tools. Do exactly this and nothing else:
1. Call the mcp__org__post_status tool once, with text exactly: ${DENIED_TEXT}
2. Then reply with one line: whether the call worked, and if it was refused, the reason you were given.`;

function checkProbes() {
  const modern = probes.modern;
  const first = modern.exchange.find((e) => e.request.method === 'POST');
  check('modern: Claude Code opens with server/discover on 2026-07-28', first?.rpc === 'server/discover' && first.request.headers['mcp-protocol-version'] === MODERN, {
    first: first && { rpc: first.rpc, version: first.request.headers['mcp-protocol-version'], status: first.response?.status },
  });
  check(`modern: the desk token arrived through \${${TOKEN_VARIABLE}} in --mcp-config`, modern.exchange.length > 0 && modern.exchange.every((e) => e.desk === 'pia'), {
    requests: modern.exchange.length,
  });
  check('modern: tools listed statelessly (no session, no GET stream, no initialize)', modern.exchange.some((e) => listed(e) && e.era === 'modern') && !modern.exchange.some((e) => e.request.method !== 'POST' || e.rpc === 'initialize' || e.request.headers['mcp-session-id']), {
    sequence: modern.exchange.map((e) => `${e.request.method} ${e.rpc ?? e.request.path} ${e.response?.status}`),
  });
  check('modern: no model call (the probe printed no init and no result)', !modern.stdoutTypes.includes('system/init') && !modern.stdoutTypes.includes('result'), { stdout: modern.stdoutTypes });

  const legacy = probes.legacy;
  const opened = legacy.exchange.find((e) => e.rpc === 'initialize');
  check('legacy: with MCP_PROTOCOL_NEGOTIATION=legacy, initialize, notifications/initialized and tools/list on one session', Boolean(opened && opened.response?.status === 200 && legacy.exchange.some((e) => e.rpc === 'notifications/initialized' && e.response?.status === 202) && legacy.exchange.some((e) => listed(e) && e.era === 'legacy')), {
    protocolVersion: opened?.request.body?.params?.protocolVersion ?? null,
    sequence: legacy.exchange.map((e) => `${e.request.method} ${e.rpc ?? e.request.path} ${e.response?.status}`),
  });

  const noToken = probes.noToken;
  const mcp = (e) => new URL(e.request.path, 'http://localhost').pathname === '/mcp';
  check('no token: every request to /mcp answered 401 and no tools listed', noToken.exchange.some(mcp) && noToken.exchange.filter(mcp).every((e) => e.response?.status === 401), {
    sequence: noToken.exchange.map((e) => `${e.request.method} ${e.rpc ?? ''} ${e.request.path} ${e.response?.status}`),
  });
  check('no token: Claude Code looks for OAuth (/.well-known, /register), each answered 404', noToken.exchange.some((e) => !mcp(e)) && noToken.exchange.filter((e) => !mcp(e)).every((e) => e.response?.status === 404), {
    paths: [...new Set(noToken.exchange.filter((e) => !mcp(e)).map((e) => `${e.request.method} ${e.request.path}`))],
  }, false);

  const wrong = probes.wrongToken;
  check('wrong token: every request answered 401, and Claude Code tried no OAuth', wrong.exchange.length > 0 && wrong.exchange.every((e) => mcp(e) && e.response?.status === 401), {
    sequence: wrong.exchange.map((e) => `${e.request.method} ${e.rpc ?? ''} ${e.request.path} ${e.response?.status}`),
  });
}

function checkRuns() {
  const callsOf = (id) => org.calls.filter((c) => c.desk === id);
  const hookCallsOf = (run) => hooks.calls.filter((h) => h.session === run.sessionId);
  const deskRequests = (id) => org.exchange.filter((e) => e.desk === id);

  for (const [label, id, tool] of [['deskA', 'ada', 'post_status'], ['deskB', 'lin', 'report']]) {
    const run = runs[label];
    const d = desk(id);
    const calls = callsOf(id);
    const call = calls.find((c) => c.tool === tool);
    const use = run.toolUses.find((u) => u.name === `mcp__org__${tool}`);
    const toolResult = use ? run.toolResults.find((r) => r.toolUseId === use.id) : undefined;
    check(`${label}: init lists the org server as connected, with mcp__org__post_status and mcp__org__report`, run.init?.org?.status === 'connected' && run.init.orgTools.includes('mcp__org__post_status') && run.init.orgTools.includes('mcp__org__report'), {
      org: run.init?.org ?? null,
      orgTools: run.init?.orgTools ?? null,
      permissionMode: run.init?.permissionMode ?? null,
    });
    check(`${label}: one ${tool} call reached the server with ${d.name}'s token and the arguments the model gave`, calls.length === 1 && call !== undefined && use !== undefined && JSON.stringify(call.arguments) === JSON.stringify(use.input), {
      era: call?.era ?? null,
      arguments: call?.arguments ?? null,
      toolUseId: use?.id ?? null,
      meta: call?.meta ?? null,
    });
    const expected = tool === 'post_status' ? same(call?.arguments.text, STATUS_TEXT) : same(call?.arguments.summary, REPORT_SUMMARY) && call?.arguments.outcome === 'done';
    check(`${label}: the arguments are the ones asked for`, expected, call?.arguments ?? null);
    check(`${label}: the tool's answer reached the model (its receipt is in the tool result and in the reply)`, Boolean(call?.receipt && toolResult?.text.includes(call.receipt) && run.result?.text?.includes(call.receipt)), {
      receipt: call?.receipt ?? null,
      toolResult: toolResult?.text ?? null,
      reply: run.result?.text ?? null,
    });
    const asked = hookCallsOf(run).filter((h) => h.event === 'PermissionRequest');
    check(`${label}: the allow rule ran the org tool without the PermissionRequest hook`, run.sessionId !== null && !asked.some((h) => String(h.tool).startsWith('mcp__org__')), {
      permissionRequests: asked.map((h) => h.tool),
      decision: run.decisions.find((x) => x.toolUseId === use?.id)?.decision ?? null,
    });
    check(`${label}: the session ended normally`, run.result !== null && !run.result.isError, run.result && { subtype: run.result.subtype, turns: run.result.turns, costUsd: run.result.costUsd });
    const meta = call?.meta ?? {};
    const linked = use !== undefined && Object.values(meta).includes(use.id);
    check(`${label}: tools/call carries the model's tool_use id in _meta`, linked, { metaKeys: Object.keys(meta) }, false);
  }
  const a = runs.deskA;
  const b = runs.deskB;
  const both = org.exchange.filter((e) => e.time >= Math.min(a.started, b.started) && e.time <= Math.max(a.ended, b.ended));
  check('deskA and deskB: every request while they worked carried one of their two tokens (none refused)', both.length > 0 && both.every((e) => e.desk === 'ada' || e.desk === 'lin'), {
    ada: deskRequests('ada').length,
    lin: deskRequests('lin').length,
    refused: both.filter((e) => e.desk === null).length,
  });
  check('deskA: the instructions reached the model (the desk code is in the reply)', Boolean(a.result?.text?.includes(desk('ada').code)), { code: desk('ada').code, reply: a.result?.text ?? null }, false);
  check("deskA: the person's own MCP servers loaded next to org (no --strict-mcp-config)", a.init !== null && a.init.otherServers.length > 0, {
    servers: a.init?.otherServers.map((s) => `${s?.name}: ${s?.status}`) ?? null,
  }, false);
  check('deskA and deskB: worked at the same time on one server, told apart by their tokens', a.started < b.ended && b.started < a.ended && callsOf('ada').length === 1 && callsOf('lin').length === 1, {
    deskA: [0, a.ended - a.started],
    deskB: [b.started - a.started, b.ended - a.started],
  });

  const c = runs.wrongToken;
  const cRequests = org.exchange.filter((e) => e.time >= c.started && e.time <= c.ended);
  check('wrongToken: init reports the org server as failed and lists none of its tools', c.init !== null && c.init.org?.status !== 'connected' && c.init.orgTools.length === 0, {
    org: c.init?.org ?? null,
    serverErrors: c.init?.serverErrors ?? null,
  });
  check('wrongToken: the server answered 401 to every request of the run, and no OAuth was tried', cRequests.length > 0 && cRequests.every((e) => e.response?.status === 401 && e.request.path === '/mcp'), {
    sequence: cRequests.map((e) => `${e.request.method} ${e.rpc ?? ''} ${e.response?.status}`),
  });
  check('wrongToken: the session went on without the tools and answered', c.result !== null && !c.result.isError && /\bNONE\b/.test(c.result.text ?? ''), { reply: c.result?.text ?? null });

  const dRun = runs.noAllowRule;
  const asked = hookCallsOf(dRun).filter((h) => h.event === 'PermissionRequest');
  const deniedUse = dRun.toolUses.find((u) => u.name === 'mcp__org__post_status');
  const deniedResult = deniedUse ? dRun.toolResults.find((r) => r.toolUseId === deniedUse.id) : undefined;
  check('noAllowRule: the org server connected (after the 401 runs, with a good token)', dRun.init?.org?.status === 'connected', { org: dRun.init?.org ?? null });
  check('noAllowRule: without an allow rule the call went to the PermissionRequest hook', asked.some((h) => h.tool === 'mcp__org__post_status'), {
    permissionRequests: asked.map((h) => h.tool),
  });
  check('noAllowRule: with no decision from the hook, -p denied the call and it never reached the server', callsOf('mo').length === 0 && Boolean(deniedResult?.isError) && dRun.result?.permissionDenials.some((p) => p?.tool_name === 'mcp__org__post_status'), {
    toolResult: deniedResult?.text ?? null,
    permissionDenials: dRun.result?.permissionDenials ?? null,
    streamDenials: dRun.denials,
    reply: dRun.result?.text ?? null,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Sanitized fixtures

function scrubber() {
  /** How Claude Code names a folder under ~/.claude/projects: every character that isn't a letter or digit becomes "-". */
  const projectFolder = (path) => path.replace(/[^a-zA-Z0-9]/g, '-');
  const pairs = [
    ...desks.map((d) => [d.token, `<desk token: ${d.id}>`]),
    ...desks.map((d) => [d.code, `<desk code: ${d.id}>`]),
    [wrongToken, '<wrong token>'],
    [neutral, '<neutral>'],
    [neutral.replaceAll('\\', '/'), '<neutral>'],
    [projectFolder(neutral), '<neutral as a project folder>'],
    [homedir(), '<home>'],
    [homedir().replaceAll('\\', '/'), '<home>'],
    [projectFolder(homedir()), '<home as a project folder>'],
    [`127.0.0.1:${orgPort}`, '127.0.0.1:<org port>'],
    [`127.0.0.1:${hookPort}`, '127.0.0.1:<hook port>'],
  ].filter(([from]) => from.length > 0);
  const fix = (text) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), text);
  const walk = (value) =>
    typeof value === 'string' ? fix(value) : Array.isArray(value) ? value.map(walk) : isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)])) : value;
  return walk;
}

/** The init message without the person's own extensions: their servers, tools, commands, skills, agents and plugins become placeholders. */
function scrubInit(init) {
  const placeholders = (list, prefix) => (Array.isArray(list) ? list.map((item, i) => (isObject(item) ? { name: `${prefix}-${i + 1}` } : `${prefix}-${i + 1}`)) : list);
  let others = 0;
  const server = (s) => (s?.name === 'org' ? s : { name: `user-server-${(others += 1)}`, status: s?.status, source: s?.source });
  return {
    ...init,
    tools: Array.isArray(init.tools) ? init.tools.filter((t) => typeof t !== 'string' || !t.startsWith('mcp__') || t.startsWith('mcp__org__')) : init.tools,
    mcp_servers: Array.isArray(init.mcp_servers) ? init.mcp_servers.map(server) : init.mcp_servers,
    slash_commands: placeholders(init.slash_commands, 'command'),
    skills: placeholders(init.skills, 'skill'),
    agents: placeholders(init.agents, 'agent'),
    plugins: placeholders(init.plugins, 'plugin'),
  };
}

/** What the switchboard reads from a desk's stream: init, denials, the turns and the result (no hook output, no rate limits). */
function streamFixture(run, scrub) {
  const kept = (m) => (m.type === 'system' && (m.subtype === 'init' || m.subtype === 'permission_denied')) || m.type === 'assistant' || m.type === 'user' || m.type === 'result';
  return run.messages
    .filter(kept)
    .map((m) => scrub(m.type === 'system' && m.subtype === 'init' ? scrubInit(m) : m))
    .map((m) => JSON.stringify(m))
    .join('\n');
}

function exchangeFixture(entries, scrub) {
  const start = entries[0]?.at ?? 0;
  return entries.map((e) => {
    const { 'content-length': _length, ...headers } = e.request.headers;
    return scrub({ at: e.at - start, desk: e.desk, era: e.era, request: { method: e.request.method, path: e.request.path, headers, body: e.request.body ?? null }, response: e.response });
  });
}

function writeFixtures(version) {
  const scrub = scrubber();
  const dir = join(repo, 'test', 'fixtures', `claude-${version}`, 'mcp');
  mkdirSync(dir, { recursive: true });
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
  const windowOf = (...list) => org.exchange.filter((e) => list.some((r) => e.time >= r.started && e.time <= r.ended));
  write('modern-exchange.json', exchangeFixture(windowOf(runs.deskA, runs.deskB), scrub));
  write('legacy-exchange.json', exchangeFixture(probes.legacy.exchange, scrub));
  write('unauthorized-exchange.json', { noToken: exchangeFixture(probes.noToken.exchange, scrub), wrongToken: exchangeFixture(probes.wrongToken.exchange, scrub) });
  write('desk-stream.jsonl', streamFixture(runs.deskA, scrub));
  write('unauthorized-stream.jsonl', streamFixture(runs.wrongToken, scrub));
  write('denied-stream.jsonl', streamFixture(runs.noAllowRule, scrub));
  const request = hooks.calls.find((h) => h.session === runs.noAllowRule.sessionId && h.tool === 'mcp__org__post_status');
  if (request) write('permission-request.json', scrub(request.payload));
  log('Wrote fixtures to', dir);
}

// ---------------------------------------------------------------------------------------------------------------------

let version = null;
try {
  if (!claude.found) throw new Error(claude.reason);
  report.claude = claude.path;
  report.claudeVersion = await new Promise((resolve) => {
    const c = spawn(claude.command, [...claude.prefixArgs, '--version'], { env: deskEnv(null), shell: false, windowsHide: true });
    let out = '';
    c.stdout.on('data', (chunk) => (out += chunk));
    c.on('error', () => resolve(null));
    c.on('close', () => resolve(out.trim() || null));
  });
  version = /^(\d+\.\d+\.\d+)\b/.exec(report.claudeVersion ?? '')?.[1] ?? null;
  log('Claude Code', report.claudeVersion);
  orgPort = await listen(org.server);
  hookPort = await listen(hooks.server);

  // Free: the connection itself, with no model call.
  await probe('modern', deskEnv(desk('pia').token), listed);
  await probe('legacy', deskEnv(desk('pia').token, { MCP_PROTOCOL_NEGOTIATION: 'legacy' }), listed);
  await probe('noToken', deskEnv(null), null, false);
  await probe('wrongToken', deskEnv(wrongToken), null);
  checkProbes();

  if (!probeOnly) {
    const config = deskConfig(orgPort);
    // Two desks at once on the one server. Ada keeps the person's own MCP servers and allows the org tools with
    // --allowedTools; Lin has only the org server and allows it in --settings, next to the hook.
    await Promise.all([
      modelRun('deskA', ['--allowedTools', 'mcp__org__*', '--settings', hookSettings(hookPort), '--mcp-config', config], deskEnv(desk('ada').token), PROMPT_STATUS),
      modelRun('deskB', ['--strict-mcp-config', '--settings', hookSettings(hookPort, { permissions: { allow: ['mcp__org'] } }), '--mcp-config', config], deskEnv(desk('lin').token), PROMPT_REPORT),
    ]);
    await modelRun('wrongToken', ['--strict-mcp-config', '--settings', hookSettings(hookPort), '--mcp-config', config], deskEnv(wrongToken), PROMPT_LIST);
    await modelRun('noAllowRule', ['--strict-mcp-config', '--settings', hookSettings(hookPort), '--mcp-config', config], deskEnv(desk('mo').token), PROMPT_DENIED);
    checkRuns();
  }
  report.passed = report.checks.filter((c) => c.required).every((c) => c.ok);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log('error', report.error);
} finally {
  await Promise.all([org.server, hooks.server].map((s) => new Promise((resolve) => (s.listening ? s.close(resolve) : resolve()))));
  const scrub = scrubber();
  report.costUsd = Object.values(runs).reduce((sum, r) => sum + (r.result?.costUsd ?? 0), 0);
  report.probes = scrub(Object.fromEntries(Object.entries(probes).map(([k, p]) => [k, { ...p, exchange: exchangeFixture(p.exchange, (x) => x) }])));
  report.runs = scrub(Object.fromEntries(Object.entries(runs).map(([k, { messages, ...r }]) => [k, { ...r, messageTypes: messages.map(kind) }])));
  report.calls = scrub(org.calls);
  report.hookCalls = scrub(hooks.calls.map(({ payload, ...h }) => ({ ...h, toolInput: payload?.tool_input ?? null })));
  report.desks = desks.map((d) => ({ id: d.id, name: d.name, role: d.role, manager: d.manager }));
  mkdirSync(join(repo, 'test-results'), { recursive: true });
  writeFileSync(join(repo, 'test-results', 'orgtools-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.passed && !probeOnly && version) writeFixtures(version);
  else if (!probeOnly) log('Fixtures not written: a required check failed or the version is unknown.');
  // Only the folder this run made: right under the temp folder, with this script's prefix.
  if (!keep && dirname(neutral) === tmpdir() && basename(neutral).startsWith(NEUTRAL_PREFIX)) rmSync(neutral, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  log(`${report.passed ? 'Passed' : 'Failed'}: ${report.checks.filter((c) => c.ok).length} of ${report.checks.length} checks. Spent $${report.costUsd.toFixed(4)} (Claude Code's own figure). Wrote test-results/orgtools-check.json`);
  process.exitCode = report.passed ? 0 : 1;
}
