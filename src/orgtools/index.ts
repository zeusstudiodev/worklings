// The org tools as an MCP server over Streamable HTTP, hand-rolled on node:http: the official packages bring express,
// hono and zod for five methods. The hub mounts it at POST /mcp behind its loopback check. Each request names its desk
// by its bearer token, and `resolve` says whose desk that is; nothing here compares tokens.
//
// Claude Code 2.1.312 speaks MCP 2026-07-28, the stateless revision: server/discover, tools/list and tools/call, each a
// POST that carries MCP-Protocol-Version, Mcp-Method (and Mcp-Name on tools/call) and, in _meta, its version, client
// info and capabilities. It falls back to the 2025-11-25 handshake (initialize, notifications/initialized, then calls on
// the Mcp-Session-Id this server issues), where a session belongs to the desk that opened it. What it really sends is
// pinned in test/fixtures/claude-2.1.312/mcp/ (docs/claude-code-surfaces.md, "Org tools over MCP").
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PACKAGE_JSON } from '../paths.ts';
import { isJson } from '../server/http.ts';
import { describeError, instructionsFor, isOrgTool, type OrgDesk, runTool, toolsListed } from './tools.ts';

export type { OrgDesk } from './tools.ts';

/** The stateless revision Claude Code opens with. */
export const MODERN = '2026-07-28';
/** The handshake revisions, newest first, for a client that opens with initialize. */
export const LEGACY: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26'];
/** The most a request body may hold. */
export const BODY_LIMIT = 1024 * 1024;
/** Handshake sessions kept at once; the oldest goes first, and its desk simply opens a new one. */
export const MAX_SESSIONS = 256;
/** The most read and dropped after a refusal sent before the body; past it the connection is cut. */
const DRAIN_LIMIT = 4 * BODY_LIMIT;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** A header that disagrees with the body (2026-07-28). */
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const pkg: unknown = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
/** The server as clients see it. The tools reach the model as mcp__org__<tool>, from the config's server name. */
const SERVER_INFO = { name: 'org', title: 'Worklings org tools', version: isObj(pkg) && typeof pkg.version === 'string' ? pkg.version : '0.0.0' };
const SERVER_META = { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };

export interface OrgToolsOptions {
  /** The desk a token belongs to, or null. The hub's table compares tokens in constant time. */
  resolve: (token: string) => OrgDesk | null;
  /** Where unexpected failures are written, never with a call's arguments or a token. Standard error by default. */
  log?: (line: string) => void;
}

type RequestId = string | number;
interface Rpc {
  /** Absent for a notification. */
  id: RequestId | undefined;
  method: string;
  params: Obj;
}

interface Session {
  company: string;
  person: string;
  version: string;
}

const rpcResult = (id: RequestId | undefined, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: RequestId | undefined, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(text ? { 'content-type': 'application/json' } : {}),
    ...(status === 204 ? {} : { 'content-length': String(Buffer.byteLength(text)) }),
    ...headers,
  });
  res.end(text);
}

/**
 * Answers before the body is read (a refusal). The rest of the body is still read and dropped, up to DRAIN_LIMIT, so the
 * client gets the answer: closing a connection under an upload resets it, and the answer is lost with it.
 */
function answerEarly(req: IncomingMessage, res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  send(res, status, body, headers);
  if (req.readableEnded) return;
  let drained = 0;
  req.on('data', (chunk: Buffer) => {
    drained += chunk.length;
    if (drained > DRAIN_LIMIT) req.socket.destroy();
  });
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** Mcp-Name and Mcp-Param-* values may come Base64-encoded as =?base64?...?=. */
function headerValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  return encoded ? Buffer.from(encoded[1] ?? '', 'base64').toString('utf8') : value;
}

/** RFC 6750's b64token, kept short: anything else can't be a desk token and never reaches `resolve`. */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]{1,512}=*)$/i;
const bearer = (authorization: string | undefined): string | null => (authorization === undefined ? null : (BEARER.exec(authorization.trim())?.[1] ?? null));

function accepts(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  return accept.split(',').some((part) => ['application/json', 'application/*', '*/*'].includes((part.split(';')[0] ?? '').trim().toLowerCase()));
}

const validId = (id: unknown): id is RequestId => (typeof id === 'string' && id.length <= 200) || (typeof id === 'number' && Number.isFinite(id));
const clip = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The body, up to BODY_LIMIT: 'too-large' past it, 'closed' when the desk hung up first. */
function readBody(req: IncomingMessage): Promise<Buffer | 'too-large' | 'closed'> {
  const declared = Number(header(req, 'content-length'));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) return Promise.resolve('too-large');
  // Read already (it shouldn't be): an empty body, so the answer is a parse error instead of a wait that never ends.
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (result: Buffer | 'too-large' | 'closed') => {
      req.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) done('too-large');
      else chunks.push(chunk);
    };
    const onEnd = () => done(Buffer.concat(chunks));
    const onClose = () => done('closed');
    const onError = (error: Error) => {
      req.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose);
      reject(error);
    };
    req.on('data', onData).on('end', onEnd).on('error', onError).on('close', onClose);
  });
}

/**
 * The handler the hub mounts at /mcp. It reads the body itself, never throws, and answers every request: 401 with no
 * detail for a missing or unknown token (before the body is read), JSON-RPC errors for malformed and oversized messages.
 */
export function orgToolsHandler(o: OrgToolsOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const log =
    o.log ??
    ((line: string) => {
      process.stderr.write(`worklings: ${line}\n`);
    });
  /** Handshake sessions by id, oldest first. */
  const sessions = new Map<string, Session>();
  const owns = (session: Session, desk: OrgDesk) => session.company === desk.company.id && session.person === desk.person;

  async function callTool(desk: OrgDesk, params: Obj): Promise<{ result: Obj } | { error: [number, string] }> {
    const name = params.name;
    if (typeof name !== 'string' || !isOrgTool(name)) {
      return { error: [INVALID_PARAMS, typeof name === 'string' ? `Unknown tool: ${clip(name)}.` : 'tools/call needs the name of a tool.'] };
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isObj(args)) return { error: [INVALID_PARAMS, 'The arguments of a tool call are an object.'] };
    const answer = await runTool(desk, name, args, log);
    return { result: { content: [{ type: 'text', text: answer.text }], isError: answer.isError } };
  }

  async function modern(req: IncomingMessage, res: ServerResponse, desk: OrgDesk, rpc: Rpc, version: string): Promise<void> {
    // 2026-07-28 defines no client notifications over HTTP: accept and drop any.
    if (rpc.id === undefined) return send(res, 202);
    const meta = isObj(rpc.params._meta) ? rpc.params._meta : {};
    if (meta['io.modelcontextprotocol/protocolVersion'] !== version) {
      return send(res, 400, rpcError(rpc.id, HEADER_MISMATCH, 'Header mismatch: MCP-Protocol-Version differs from the protocolVersion in _meta.'));
    }
    if (version !== MODERN) {
      return send(res, 400, rpcError(rpc.id, UNSUPPORTED_VERSION, 'Unsupported protocol version.', { supported: [MODERN, ...LEGACY], requested: clip(version, 40) }));
    }
    const method = header(req, 'mcp-method');
    if (method !== undefined && method !== rpc.method) return send(res, 400, rpcError(rpc.id, HEADER_MISMATCH, 'Header mismatch: Mcp-Method differs from the method in the body.'));
    if (rpc.method === 'tools/call') {
      const named = headerValue(header(req, 'mcp-name'));
      if (named !== undefined && named !== rpc.params.name) return send(res, 400, rpcError(rpc.id, HEADER_MISMATCH, 'Header mismatch: Mcp-Name differs from the tool name in the body.'));
    }
    const done = (result: Obj) => send(res, 200, rpcResult(rpc.id, { resultType: 'complete', ...result, _meta: SERVER_META }));
    switch (rpc.method) {
      case 'server/discover':
        return done({ supportedVersions: [MODERN], capabilities: { tools: {} }, instructions: instructionsFor(desk) });
      case 'tools/list':
        return done({ tools: toolsListed(desk) });
      case 'tools/call': {
        const called = await callTool(desk, rpc.params);
        return 'error' in called ? send(res, 200, rpcError(rpc.id, ...called.error)) : done(called.result);
      }
      case 'ping':
        return done({});
      default:
        return send(res, 200, rpcError(rpc.id, METHOD_NOT_FOUND, `Method not found: ${clip(rpc.method)}.`));
    }
  }

  function initialize(res: ServerResponse, desk: OrgDesk, rpc: Rpc): void {
    if (rpc.id === undefined) return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'initialize is a request: give it an id.'));
    const asked = rpc.params.protocolVersion;
    const version = typeof asked === 'string' && LEGACY.includes(asked) ? asked : (LEGACY[0] ?? MODERN);
    // A session is a name, not a credential: every request still brings the token of the desk that opened it.
    const sessionId = randomUUID();
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next();
      if (!oldest.done) sessions.delete(oldest.value);
    }
    sessions.set(sessionId, { company: desk.company.id, person: desk.person, version });
    const result = { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: instructionsFor(desk) };
    return send(res, 200, rpcResult(rpc.id, result), { 'mcp-session-id': sessionId });
  }

  async function legacy(req: IncomingMessage, res: ServerResponse, desk: OrgDesk, rpc: Rpc, sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session || !owns(session, desk)) return send(res, 404, rpcError(rpc.id, INVALID_REQUEST, 'Session not found: start again with initialize.'));
    const version = header(req, 'mcp-protocol-version');
    if (version !== undefined && version !== session.version) return send(res, 400, rpcError(rpc.id, INVALID_REQUEST, `This session speaks ${session.version}.`));
    // Most recently used last, so the oldest is the one that goes when the table is full.
    sessions.delete(sessionId);
    sessions.set(sessionId, session);
    if (rpc.id === undefined) return send(res, 202);
    switch (rpc.method) {
      case 'ping':
        return send(res, 200, rpcResult(rpc.id, {}));
      case 'tools/list':
        return send(res, 200, rpcResult(rpc.id, { tools: toolsListed(desk) }));
      case 'tools/call': {
        const called = await callTool(desk, rpc.params);
        return send(res, 200, 'error' in called ? rpcError(rpc.id, ...called.error) : rpcResult(rpc.id, called.result));
      }
      default:
        return send(res, 200, rpcError(rpc.id, METHOD_NOT_FOUND, `Method not found: ${clip(rpc.method)}.`));
    }
  }

  function endSession(req: IncomingMessage, res: ServerResponse, desk: OrgDesk): void {
    const sessionId = header(req, 'mcp-session-id');
    const session = sessionId === undefined ? undefined : sessions.get(sessionId);
    if (sessionId === undefined || !session || !owns(session, desk)) return send(res, 404, rpcError(undefined, INVALID_REQUEST, 'Session not found.'));
    sessions.delete(sessionId);
    return send(res, 204);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A browser always sends Origin, and Claude Code never does: no web page may reach the org tools.
    if (req.headers.origin !== undefined) return answerEarly(req, res, 403, rpcError(undefined, INVALID_REQUEST, 'The org tools answer only desks on this computer.'));
    const authorization = header(req, 'authorization');
    const token = bearer(authorization);
    const desk = token === null ? null : o.resolve(token);
    if (!desk) {
      const challenge = `Bearer realm="worklings-org"${authorization === undefined ? '' : ', error="invalid_token"'}`;
      return answerEarly(req, res, 401, undefined, { 'www-authenticate': challenge });
    }
    if (req.method === 'DELETE') return endSession(req, res, desk);
    // No server-to-client stream: a GET is answered 405, which tells a legacy client so.
    if (req.method !== 'POST') return answerEarly(req, res, 405, undefined, { allow: 'POST, DELETE' });
    if (!isJson(header(req, 'content-type'))) return answerEarly(req, res, 415, rpcError(undefined, INVALID_REQUEST, 'Send one JSON-RPC message as application/json.'));
    if (!accepts(header(req, 'accept'))) return answerEarly(req, res, 406, rpcError(undefined, INVALID_REQUEST, 'Accept application/json: this server answers in JSON.'));

    const body = await readBody(req);
    if (body === 'closed') return;
    if (body === 'too-large') return answerEarly(req, res, 413, rpcError(undefined, INVALID_REQUEST, 'The message is larger than 1 MB.'));
    let raw: unknown;
    try {
      raw = JSON.parse(UTF8.decode(body));
    } catch {
      return send(res, 400, rpcError(undefined, PARSE_ERROR, 'Parse error: the body is not JSON in UTF-8.'));
    }
    if (Array.isArray(raw)) return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'Send one JSON-RPC message at a time, not a batch.'));
    if (!isObj(raw) || raw.jsonrpc !== '2.0') return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'Send a JSON-RPC 2.0 message.'));
    const hasId = Object.hasOwn(raw, 'id');
    if (hasId && !validId(raw.id)) return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'A request id is a string or a number.'));
    const id = hasId && validId(raw.id) ? raw.id : undefined;
    // A response from the client answers nothing this server asked: there is nothing to do with it.
    if (!Object.hasOwn(raw, 'method') && (Object.hasOwn(raw, 'result') || Object.hasOwn(raw, 'error'))) return send(res, 202);
    if (typeof raw.method !== 'string' || raw.method === '' || raw.method.length > 100) return send(res, 400, rpcError(id, INVALID_REQUEST, 'A request needs its method as a string.'));
    if (raw.params !== undefined && !isObj(raw.params)) return send(res, 400, rpcError(id, INVALID_REQUEST, 'params is an object.'));
    const rpc: Rpc = { id, method: raw.method, params: isObj(raw.params) ? raw.params : {} };

    const sessionId = header(req, 'mcp-session-id');
    const version = header(req, 'mcp-protocol-version');
    if (rpc.method === 'initialize') return initialize(res, desk, rpc);
    if (sessionId !== undefined) return legacy(req, res, desk, rpc, sessionId);
    if (version !== undefined && !LEGACY.includes(version)) return modern(req, res, desk, rpc, version);
    return send(res, 400, rpcError(rpc.id, INVALID_REQUEST, `Start with initialize, or send MCP-Protocol-Version: ${MODERN}.`));
  }

  return async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      log(`the org tools failed on a request: ${describeError(error)}`);
      if (!res.headersSent) send(res, 500, rpcError(undefined, INTERNAL_ERROR, 'Internal error.'));
      else res.destroy();
    }
  };
}
