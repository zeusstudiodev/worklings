// The office's HTTP server: hook and telemetry intake from Claude Code, a Server-Sent Events stream and a small JSON
// API for the browser, and the built web app. Local by default, with guards against cross-site requests and DNS
// rebinding, and a token for everything but the demo.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Office } from './office.ts';
import { costEventsFromOtlp } from './otel.ts';
import { sameToken } from './token.ts';

/** A handler's status and JSON body, for routes that answer with more than 200. */
export interface ApiReply {
  status: number;
  body: unknown;
}

export interface ApiHandlers {
  /** GET /api/studio: the studio with its files and the library catalogue for hiring. */
  studio?: () => unknown;
  /** POST /api/reshape: hire, fire, move, change model, edit a rule. */
  reshape?: (body: unknown) => Promise<unknown> | unknown;
  /** GET /api/sessions: past sessions that can be replayed. */
  sessions?: () => unknown;
  /** POST /api/replay: start replaying a session. */
  replay?: (body: unknown) => Promise<unknown> | unknown;
  /** POST /api/ask {agentKey, question}: a side question to someone (202 {id}; the answer comes in a snapshot). */
  ask?: (body: unknown) => ApiReply;
  /** POST /api/catch-up {}: a digest of what happened (202 {id}, or 200 with a digest when nothing is new). */
  catchUp?: (body: unknown) => ApiReply;
  /** POST /api/aside/cancel {id}: stops the running question or catch-up. */
  cancelAside?: (body: unknown) => ApiReply;
}

export interface ServerOptions {
  office: Office;
  /** Address to bind: 127.0.0.1 normally, 0.0.0.0 with --lan. */
  host: string;
  /** 0 picks a free port (tests). */
  port: number;
  token: string;
  lan: boolean;
  webDir: string | null;
  api?: ApiHandlers;
  tickMs?: number;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export class HttpError extends Error {
  readonly status: number;
  /** A word for the browser to act on ("busy", "rate-limited"), sent next to the message. */
  readonly code: string | null;
  /** Seconds until trying again makes sense: sent as Retry-After and in the body. */
  readonly retryAfter: number | null;

  constructor(status: number, message: string, extra: { code?: string; retryAfter?: number | null } = {}) {
    super(message);
    this.status = status;
    this.code = extra.code ?? null;
    this.retryAfter = extra.retryAfter ?? null;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** The routes that call Claude Code for the person: Ask aside and Catch me up. */
const ASIDE_PATHS: ReadonlySet<string> = new Set(['/api/ask', '/api/catch-up', '/api/aside/cancel']);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
};
/**
 * The web app's policy. 'wasm-unsafe-eval' lets three's meshopt decoder compile its WebAssembly (the people and the
 * scenery are meshopt-compressed); it allows no eval of script text. The hub adds a frame-src for the preview proxies'
 * origins (`withFrames`).
 */
export const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** The policy with `frame-src` naming exactly these origins ('none' when there are none). */
export const withFrames = (origins: readonly string[]): string => `${CSP}; frame-src ${origins.length > 0 ? origins.join(' ') : "'none'"}`;

/** The Host header's name without its port, as sent (`[::1]` keeps its brackets). */
export function hostOf(req: IncomingMessage): string {
  const host = req.headers.host ?? '';
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
}

/** True when the request names this machine in its Host header, which a DNS-rebinding page can't do. */
export const loopbackHost = (req: IncomingMessage): boolean => LOOPBACK.has(hostOf(req).toLowerCase());

/** True for a connection from this machine. With --lan the Host header proves nothing: anyone can send one. */
export const fromThisMachine = (address: string | undefined): boolean =>
  /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(address ?? '');

/** A browser always sends Origin on cross-site requests; only same-origin ones may pass. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${req.headers.host ?? ''}`;
}

/** The office's token from `Authorization: Bearer`, or from `?token=` (EventSource and images can't set headers). */
export function tokenOf(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return url.searchParams.get('token');
}

/**
 * True for `application/json`, in any case, with no parameter or a UTF-8 charset (the body is always read as UTF-8).
 * `application/json-patch+json` or `text/plain; application/json` aren't JSON bodies the office reads.
 */
export function isJson(contentType: string | undefined): boolean {
  const [media = '', ...params] = (contentType ?? '').split(';').map((part) => part.trim().toLowerCase());
  if (media !== 'application/json') return false;
  return params.every((param) => /^charset="?utf-?8"?$/.test(param));
}

/** Reads a JSON body of at most `limit` bytes. */
export async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!isJson(req.headers['content-type'])) throw new HttpError(415, 'Send JSON (Content-Type: application/json).');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Body is not valid JSON.');
  }
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(text);
}

export function sendError(res: ServerResponse, error: unknown, status: number) {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof HttpError)) return send(res, status, { error: message });
  const retry = error.retryAfter === null ? {} : { retryAfter: error.retryAfter };
  send(res, status, { error: message, ...(error.code ? { code: error.code } : {}), ...retry }, error.retryAfter === null ? {} : { 'retry-after': String(error.retryAfter) });
}

/**
 * The built web app: a file under `webDir`, never outside it, or index.html for an address the app routes itself
 * ("/rooms/design", "/c/plant-pal/inbox"). Pages get `csp` and may not be framed. Files outside assets/ keep their
 * names between builds (the art in /art/ among them), so they carry an ETag: a browser that has the file gets a 304.
 */
export function serveWebApp(webDir: string | null, req: IncomingMessage, path: string, res: ServerResponse, csp = CSP) {
  if (!webDir || !existsSync(join(webDir, 'index.html'))) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The office web app is not built. Run `npm run build` (or use `npm run dev` while developing).');
    return;
  }
  const root = resolve(webDir);
  let target = resolve(root, `.${decodeURIComponent(path)}`);
  if (target !== root && !target.startsWith(root + sep)) throw new HttpError(403, 'Outside the web folder.');
  if (!existsSync(target) || statSync(target).isDirectory()) {
    if (extname(path)) throw new HttpError(404, 'Not found.');
    target = join(root, 'index.html');
  }
  const ext = extname(target);
  const file = statSync(target);
  const etag = `W/"${file.size.toString(16)}-${Math.floor(file.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag,
  };
  if (ext === '.html') {
    headers['content-security-policy'] = csp;
    headers['x-frame-options'] = 'DENY';
  }
  const known = req.headers['if-none-match']?.split(',').map((tag) => tag.trim());
  if (known?.includes(etag) || known?.includes('*')) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else createReadStream(target).pipe(res);
}

export function startServer(o: ServerOptions): Promise<RunningServer> {
  const { office } = o;

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) process.stderr.write(`worklings: ${(error as Error).stack ?? String(error)}\n`);
      if (!res.headersSent) sendError(res, error, status);
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (!o.lan && !loopbackHost(req)) throw new HttpError(403, 'This office only answers on localhost.');

    // Intake from Claude Code on this machine: never from the network, and no browser may post here. Any query passes:
    // it only marks which hooks in a settings file are ours, and hooks installed before the rename carry the old marker.
    if (req.method === 'POST' && (path === '/hooks' || path === '/otel/v1/logs')) {
      if (!fromThisMachine(req.socket.remoteAddress) || !loopbackHost(req) || req.headers.origin !== undefined) throw new HttpError(403, 'Hooks are accepted only from this machine.');
      if (path === '/hooks') {
        const payload = await readBody(req, 1024 * 1024);
        // Answer first: Claude Code waits for this response before the tool call continues.
        res.writeHead(200, { 'content-length': '0' });
        res.end();
        office.ingestHook(payload);
        return;
      }
      const type = req.headers['content-type'] ?? '';
      if (!type.includes('json')) throw new HttpError(415, 'Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json; protobuf is not supported.');
      const payload = await readBody(req, 4 * 1024 * 1024);
      office.ingestCosts(costEventsFromOtlp(payload, Date.now()));
      send(res, 200, {});
      return;
    }

    const api = path === '/events' || path.startsWith('/api/');
    if (api) {
      if (!sameOrigin(req)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
      // Prompts, commands and costs are private: reading them takes the token too, except in the made-up demo.
      const open = req.method === 'GET' && office.mode === 'demo' && !o.lan;
      if (!open && !sameToken(tokenOf(req, url), o.token)) throw new HttpError(401, 'Open the office with the link the CLI printed: it carries the access token.');
    }

    if (req.method === 'GET' && path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 2000\n\n');
      const unsubscribe = office.subscribe((snapshot) => res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }
    if (req.method === 'GET' && path === '/api/state') return send(res, 200, office.snapshot());
    if (req.method === 'GET' && path === '/api/studio' && o.api?.studio) return send(res, 200, o.api.studio());
    if (req.method === 'GET' && path === '/api/sessions' && o.api?.sessions) return send(res, 200, o.api.sessions());
    if (req.method === 'POST' && path === '/api/reshape' && o.api?.reshape) return send(res, 200, await o.api.reshape(await readBody(req, 256 * 1024)));
    if (req.method === 'POST' && path === '/api/replay' && o.api?.replay) return send(res, 200, await o.api.replay(await readBody(req, 16 * 1024)));
    // Questions and catch-ups call Claude Code: like every change, they take the token in every mode, the demo included.
    // On the local network the token travels over plain HTTP, and an answer can spell out a session's context, so they
    // are taken only from the computer the office runs on.
    if (o.lan && ASIDE_PATHS.has(path) && !fromThisMachine(req.socket.remoteAddress)) {
      throw new HttpError(403, 'Questions and catch-ups work only on the computer running the office: open it there at localhost.', { code: 'local-only' });
    }
    const reply = (r: ApiReply) => send(res, r.status, r.body);
    if (req.method === 'POST' && path === '/api/ask' && o.api?.ask) return reply(o.api.ask(await readBody(req, 4 * 1024)));
    if (req.method === 'POST' && path === '/api/catch-up' && o.api?.catchUp) return reply(o.api.catchUp(await readBody(req, 1024)));
    if (req.method === 'POST' && path === '/api/aside/cancel' && o.api?.cancelAside) return reply(o.api.cancelAside(await readBody(req, 1024)));
    if (api) throw new HttpError(404, 'No such endpoint.');

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    serveWebApp(o.webDir, req, path, res);
  }

  let ticks = 0;
  let lastProblem = '';
  const timer = setInterval(() => {
    ticks += 1;
    // One bad transcript or studio file must not take the office down with it: report it (once) and keep going.
    try {
      if (ticks % 10 === 0) office.poll();
      office.flush();
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      if (problem !== lastProblem) process.stderr.write(`worklings: ${problem}
`);
      lastProblem = problem;
    }
  }, o.tickMs ?? 100);

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : o.port;
      const shown = o.host === '0.0.0.0' ? '127.0.0.1' : o.host;
      resolvePromise({
        server,
        port,
        url: `http://${shown}:${port}/`,
        close: () =>
          new Promise((done) => {
            clearInterval(timer);
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
