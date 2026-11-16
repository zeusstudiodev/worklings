// The studio chat's tools as an MCP server over Streamable HTTP, the same protocol the org tools speak to company desks
// (src/orgtools/index.ts): MCP 2026-07-28's stateless requests, with the 2025-11-25 handshake as a fallback. The hub
// mounts it at POST /mcp for the studio desk's token only (src/hub/intake.ts), after its loopback check. Nothing here
// compares tokens: `resolve` is the hub's table.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BODY_LIMIT, LEGACY, MODERN } from '../orgtools/index.ts';
import { isJson } from '../server/http.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Obj;
}

export interface McpServerOptions<C> {
  /** The caller a token stands for, or null. */
  resolve: (token: string) => C | null;
  tools: readonly McpTool[];
  instructions: string;
  /** Runs a tool; never throws for a refusal, which comes back as `isError` with a sentence. */
  call: (caller: C, name: string, args: Obj) => Promise<{ text: string; isError: boolean }>;
  log?: (line: string) => void;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;
const MAX_SESSIONS = 32;
const SERVER_INFO = { name: 'org', title: 'Worklings studio chat tools', version: '0.3.0' };
const SERVER_META = { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]{1,512}=*)$/i;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

type Id = string | number;
const rpcResult = (id: Id | undefined, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: Id | undefined, code: number, message: string) => ({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code, message } });
const clip = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

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

const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
};

function headerValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  return encoded ? Buffer.from(encoded[1] ?? '', 'base64').toString('utf8') : value;
}

function readBody(req: IncomingMessage): Promise<Buffer | 'too-large' | 'closed'> {
  const declared = Number(header(req, 'content-length'));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) return Promise.resolve('too-large');
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const off = () => req.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose);
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        off();
        resolve('too-large');
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      off();
      resolve(Buffer.concat(chunks));
    };
    const onClose = () => {
      off();
      resolve('closed');
    };
    const onError = (error: Error) => {
      off();
      reject(error);
    };
    req.on('data', onData).on('end', onEnd).on('error', onError).on('close', onClose);
  });
}

/** The handler for POST and DELETE /mcp. It reads the body itself, never throws, and answers every request. */
export function mcpServer<C>(o: McpServerOptions<C>): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const log = o.log ?? ((line: string) => void process.stderr.write(`worklings: ${line}\n`));
  /** Handshake sessions, each bound to the token that opened it. */
  const sessions = new Map<string, { token: string; version: string }>();
  const names = new Set(o.tools.map((t) => t.name));

  async function callTool(caller: C, params: Obj): Promise<{ result: Obj } | { error: [number, string] }> {
    const name = params.name;
    if (typeof name !== 'string' || !names.has(name)) return { error: [INVALID_PARAMS, typeof name === 'string' ? `Unknown tool: ${clip(name)}.` : 'tools/call needs the name of a tool.'] };
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isObj(args)) return { error: [INVALID_PARAMS, 'The arguments of a tool call are an object.'] };
    const answer = await o.call(caller, name, args);
    return { result: { content: [{ type: 'text', text: answer.text }], isError: answer.isError } };
  }

  async function method(caller: C, name: string, params: Obj): Promise<{ result: Obj } | { error: [number, string] }> {
    switch (name) {
      case 'server/discover':
        return { result: { supportedVersions: [MODERN], capabilities: { tools: {} }, instructions: o.instructions } };
      case 'tools/list':
        return { result: { tools: o.tools.map((t) => ({ ...t })) } };
      case 'tools/call':
        return callTool(caller, params);
      case 'ping':
        return { result: {} };
      default:
        return { error: [METHOD_NOT_FOUND, `Method not found: ${clip(name)}.`] };
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A browser always sends Origin, and Claude Code never does: no web page may reach these tools.
    if (req.headers.origin !== undefined) return send(res, 403, rpcError(undefined, INVALID_REQUEST, 'These tools answer only the studio chat on this computer.'));
    const token = BEARER.exec((header(req, 'authorization') ?? '').trim())?.[1] ?? null;
    const caller = token === null ? null : o.resolve(token);
    if (!caller || token === null) return send(res, 401, undefined, { 'www-authenticate': 'Bearer realm="worklings-studio"' });
    if (req.method === 'DELETE') {
      const sessionId = header(req, 'mcp-session-id');
      if (sessionId === undefined || sessions.get(sessionId)?.token !== token) return send(res, 404, rpcError(undefined, INVALID_REQUEST, 'Session not found.'));
      sessions.delete(sessionId);
      return send(res, 204);
    }
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST, DELETE' });
    if (!isJson(header(req, 'content-type'))) return send(res, 415, rpcError(undefined, INVALID_REQUEST, 'Send one JSON-RPC message as application/json.'));
    const body = await readBody(req);
    if (body === 'closed') return;
    if (body === 'too-large') return send(res, 413, rpcError(undefined, INVALID_REQUEST, 'The message is larger than 1 MB.'));
    let raw: unknown;
    try {
      raw = JSON.parse(UTF8.decode(body));
    } catch {
      return send(res, 400, rpcError(undefined, PARSE_ERROR, 'Parse error: the body is not JSON in UTF-8.'));
    }
    if (!isObj(raw) || raw.jsonrpc !== '2.0') return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'Send one JSON-RPC 2.0 message.'));
    const validId = (v: unknown): v is Id => (typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v));
    const id = Object.hasOwn(raw, 'id') ? (validId(raw.id) ? raw.id : null) : undefined;
    if (id === null) return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'A request id is a string or a number.'));
    if (!Object.hasOwn(raw, 'method') && (Object.hasOwn(raw, 'result') || Object.hasOwn(raw, 'error'))) return send(res, 202);
    if (typeof raw.method !== 'string' || raw.method === '' || raw.method.length > 100) return send(res, 400, rpcError(id, INVALID_REQUEST, 'A request needs its method as a string.'));
    if (raw.params !== undefined && !isObj(raw.params)) return send(res, 400, rpcError(id, INVALID_REQUEST, 'params is an object.'));
    const params = isObj(raw.params) ? raw.params : {};
    const sessionId = header(req, 'mcp-session-id');
    const version = header(req, 'mcp-protocol-version');

    if (raw.method === 'initialize') {
      if (id === undefined) return send(res, 400, rpcError(undefined, INVALID_REQUEST, 'initialize is a request: give it an id.'));
      const asked = params.protocolVersion;
      const chosen = typeof asked === 'string' && LEGACY.includes(asked) ? asked : (LEGACY[0] ?? MODERN);
      const fresh = randomUUID();
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = sessions.keys().next();
        if (!oldest.done) sessions.delete(oldest.value);
      }
      sessions.set(fresh, { token, version: chosen });
      return send(res, 200, rpcResult(id, { protocolVersion: chosen, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: o.instructions }), { 'mcp-session-id': fresh });
    }
    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (!session || session.token !== token) return send(res, 404, rpcError(id, INVALID_REQUEST, 'Session not found: start again with initialize.'));
      if (id === undefined) return send(res, 202);
      const done = await method(caller, raw.method, params);
      return send(res, 200, 'error' in done ? rpcError(id, ...done.error) : rpcResult(id, done.result));
    }
    if (version === undefined || LEGACY.includes(version)) return send(res, 400, rpcError(id, INVALID_REQUEST, `Start with initialize, or send MCP-Protocol-Version: ${MODERN}.`));
    if (id === undefined) return send(res, 202);
    const meta = isObj(params._meta) ? params._meta : {};
    if (meta['io.modelcontextprotocol/protocolVersion'] !== version) return send(res, 400, rpcError(id, HEADER_MISMATCH, 'Header mismatch: MCP-Protocol-Version differs from the protocolVersion in _meta.'));
    if (version !== MODERN) return send(res, 400, rpcError(id, UNSUPPORTED_VERSION, 'Unsupported protocol version.'));
    const named = header(req, 'mcp-method');
    if (named !== undefined && named !== raw.method) return send(res, 400, rpcError(id, HEADER_MISMATCH, 'Header mismatch: Mcp-Method differs from the method in the body.'));
    if (raw.method === 'tools/call') {
      const tool = headerValue(header(req, 'mcp-name'));
      if (tool !== undefined && tool !== params.name) return send(res, 400, rpcError(id, HEADER_MISMATCH, 'Header mismatch: Mcp-Name differs from the tool name in the body.'));
    }
    const done = await method(caller, raw.method, params);
    if ('error' in done) return send(res, 200, rpcError(id, ...done.error));
    return send(res, 200, rpcResult(id, { resultType: 'complete', ...done.result, _meta: SERVER_META }));
  }

  return async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      log(`the studio chat's tools failed on a request: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) send(res, 500, rpcError(undefined, INTERNAL_ERROR, 'Internal error.'));
      else res.destroy();
    }
  };
}
