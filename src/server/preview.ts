// The preview: the project's own dev server, shown in the office. The office runs the project's dev script (`npm run
// dev`, else `npm run start`) in the project folder without a shell, reads the first local address it prints, and puts
// a proxy on 127.0.0.1 with a port of its own in front of it. The app is then a different origin from the office, so
// its scripts can't reach the office's API. The proxy answers only requests addressed to itself (a guard against DNS
// rebinding) and forwards them, WebSocket upgrades for hot reload included, only to that one local dev server, without
// the cookies, Authorization header or foreign referrer the browser attaches. Stopping kills the whole process tree.
// What the dev server prints is untrusted: only its address is read, and a line quoted in a problem is masked and cut.
//
// On the tailnet anyone Tailscale lets reach this computer could reach the proxy, so there it lets in only a browser
// that opened the preview from the office: the address the office shows carries a random key, which the proxy trades
// once for an HttpOnly cookie and sends the browser on to the same address without it. Neither the key nor the cookie
// ever reaches the dev server.
import { type ChildProcess, execFile, spawn, type SpawnOptions } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { Agent, createServer, type IncomingMessage, request, type ServerResponse, STATUS_CODES } from 'node:http';
import { connect } from 'node:net';
import { join, posix, win32 } from 'node:path';
import type { Duplex, Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { PreviewView } from '../core/company.ts';
import { redactClip } from '../core/redact.ts';
import { sameToken } from './token.ts';

/** How long a dev command may take to print a local address that answers before the office stops it. */
export const START_TIMEOUT_MS = 60_000;
/** How long what was read from a project's package.json is kept before it is read again. */
const DETECT_TTL_MS = 5_000;
/** How long a killed dev command may take to go before stopping carries on anyway. */
const KILL_WAIT_MS = 5_000;
/** How long after it exits the office waits for the rest of its output, when its pipes don't close by then. */
const EXIT_GRACE_MS = 500;
/**
 * How long taskkill may walk the tree. It takes a second or more on a busy machine, and stopping it early leaves only
 * the fallback, which kills npm and orphans the dev server it started, so this guards against a hung taskkill only.
 */
const TASKKILL_MS = 30_000;
/** Lines of the dev command's output kept, for the sentence that says why it stopped. */
const KEPT_LINES = 20;
/** A line longer than this is read in pieces (a progress bar that never ends its line can't grow without bound). */
const LINE_CHARS = 4_096;
const PACKAGE_JSON_BYTES = 1024 * 1024;
/** One try at the printed address, and the wait between tries while the dev server isn't listening yet. */
const PROBE_MS = 1_000;
const PROBE_EVERY_MS = 250;

/** Starts a process: node:child_process's spawn, or a test's stand-in. */
export type StartProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface PreviewOptions {
  /** Starts the dev command; node:child_process's spawn when not given. */
  spawn?: StartProcess;
  /** The clock for how long what was read from package.json is kept. */
  now?: () => number;
  /** The environment the dev command starts from: process.env when not given. */
  env?: NodeJS.ProcessEnv;
  /** Called after a company's preview changes, so the hub can send a new snapshot. */
  onChange?: (companyId: string) => void;
  /** How long the dev command may take to print an address that answers: START_TIMEOUT_MS when not given. */
  startTimeoutMs?: number;
  /**
   * Starts the clock that gives up on a dev command after `ms` without an address, and returns what stops it:
   * setTimeout when not given. Tests pass their own, to say when the time is up.
   */
  deadline?: (giveUp: () => void, ms: number) => () => void;
  /**
   * The hub's tailnet while --tailnet is on, else null: each preview that is up is then served on an https port of its
   * own on the ts.net name too, for a phone, and taken off it when it stops. Asked again for each preview.
   */
  tailnet?: () => PreviewTailnet | null;
}

/** What the preview needs of the tailnet (src/server/tailnet.ts's Tailnet). */
export interface PreviewTailnet {
  serve(port: number): Promise<{ host: string; port: number; url: string; stop(): Promise<void> }>;
}

export interface Previews {
  /** Starts the project's dev server behind its proxy; a preview that is already starting or up is returned as it is. */
  start(companyId: string, root: string): PreviewView;
  /** Stops the dev server with its whole process tree and closes the proxy. */
  stop(companyId: string): Promise<PreviewView>;
  /** The preview as the office shows it. With `root`, a preview that is off names the command a start would run. */
  view(companyId: string, root?: string): PreviewView;
  closeAll(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The project's dev command

export interface DevScript {
  script: 'dev' | 'start';
  /** As the office shows it: "npm run dev". */
  command: string;
  /** package.json lists dependencies, so a missing node_modules folder is worth pointing out. */
  dependencies: boolean;
}

export type Detection = { ok: true; dev: DevScript } | { ok: false; problem: string };

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const field = (o: unknown, key: string): unknown => (isObject(o) && Object.hasOwn(o, key) ? o[key] : undefined);

function isFolder(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    // A folder this user may not read counts as missing: nothing could run there either.
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    // Unreadable counts as missing.
    return false;
  }
}

/** The project's dev script from its package.json: `dev`, else `start`. */
export function devScript(root: string): Detection {
  if (!isFolder(root)) return { ok: false, problem: `The project folder isn't at ${root} any more.` };
  const file = join(root, 'package.json');
  let text: string;
  try {
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) return { ok: false, problem: "The project has no package.json, so there's no app the office knows how to start." };
    if (stat.size > PACKAGE_JSON_BYTES) return { ok: false, problem: "The project's package.json is over 1 MB, so the office doesn't read it." };
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { ok: false, problem: `The office couldn't read the project's package.json${codeOf(error) ? ` (${codeOf(error)})` : ''}.` };
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, problem: "The project's package.json isn't valid JSON, so the office can't tell how to start the app." };
  }
  const scripts = field(pkg, 'scripts');
  const script = (['dev', 'start'] as const).find((name) => {
    const body = field(scripts, name);
    return typeof body === 'string' && body.trim() !== '';
  });
  if (!script) return { ok: false, problem: "The project's package.json has no dev or start script, so there's no app to start." };
  const listed = (key: string) => {
    const deps = field(pkg, key);
    return isObject(deps) && Object.keys(deps).length > 0;
  };
  return { ok: true, dev: { script, command: `npm run ${script}`, dependencies: listed('dependencies') || listed('devDependencies') } };
}

export interface NpmLookup {
  /** What to spawn: this Node for npm's CLI script, or an npm that starts without a shell. */
  command: string;
  /** Arguments before npm's own: the CLI script when `command` is Node. */
  args: string[];
}

/** Windows variable names ignore case, and a copied environment keeps whatever case it had ("Path"). */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32' || Object.hasOwn(env, name)) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, '$1');

/**
 * npm, started without a shell. Windows' npm.cmd can't start without one, so npm runs as its own CLI script with this
 * Node: the one beside this Node first, then the one beside an npm on the PATH. Elsewhere an npm on the PATH that isn't a
 * link into a Node install (Volta's) starts as it is. Empty and relative PATH entries are skipped, so a project folder
 * can't supply an npm of its own. Null when there is none.
 */
export function findNpm(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = isFile,
  node: string = process.execPath,
): NpmLookup | null {
  const p = platform === 'win32' ? win32 : posix;
  // npm's CLI script in a Node install: beside node.exe on Windows, in lib/ beside bin/ elsewhere.
  const cliIn = (dir: string) => (platform === 'win32' ? p.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : p.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  const withNode = (cli: string): NpmLookup => ({ command: node, args: [cli] });
  const beside = cliIn(p.dirname(node));
  if (exists(beside)) return withNode(beside);
  const dirs = (envValue(env, 'PATH', platform) ?? '').split(p.delimiter).map(unquote).filter((dir) => dir !== '' && p.isAbsolute(dir));
  for (const dir of dirs) {
    const shim = p.join(dir, platform === 'win32' ? 'npm.cmd' : 'npm');
    if (!exists(shim)) continue;
    if (exists(cliIn(dir))) return withNode(cliIn(dir));
    if (platform !== 'win32') return { command: shim, args: [] };
  }
  return null;
}

/** What the office sets for the dev command: no browser tab of its own (the office shows the app), no npm update check. */
const DEV_ENV: Readonly<Record<string, string>> = { BROWSER: 'none', npm_config_update_notifier: 'false' };

function devEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ours = new Set(Object.keys(DEV_ENV).map((name) => name.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) if (!ours.has(name.toUpperCase())) env[name] = value;
  return { ...env, ...DEV_ENV };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading what it prints

/**
 * Terminal escapes: OSC (links, titles) up to BEL or ESC \, CSI (colours, cursor moves), and the short ESC forms. Tabs
 * become spaces first, so the only control characters left to start one are ESC and its kin.
 */
const ESCAPES = /\p{Cc}\][^\p{Cc}]*(?:\p{Cc}\\|\p{Cc})?|\p{Cc}\[[0-?]*[ -/]*[@-~]|\p{Cc}[ -/]+[0-~]|\p{Cc}[@-Z\\-_]/gu;

/** A line as the office reads it: terminal colours, links and other escapes gone, control characters as spaces. */
export function plainLine(text: string): string {
  return text.replaceAll('\t', ' ').replace(ESCAPES, '').replace(/\p{Cc}/gu, ' ').trimEnd();
}

export interface LocalAddress {
  /** As printed, without its path: "http://localhost:5173". */
  origin: string;
  secure: boolean;
  /** As printed, in lower case: localhost, 127.0.0.1, 0.0.0.0, [::1] or [::]. */
  host: string;
  port: number;
  /** The printed path, "/" at least. */
  path: string;
}

const LOCAL_URL = /(?<![\w+.-])(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{1,5})(\/[^\s"'<>`]*)?/gi;

/** The first local address with a port in a line a dev server printed (escapes already gone), or null. */
export function localAddress(line: string): LocalAddress | null {
  for (const m of line.matchAll(LOCAL_URL)) {
    const port = Number(m[3]);
    if (!(port >= 1 && port <= 65_535)) continue;
    const scheme = (m[1] ?? '').toLowerCase();
    const host = (m[2] ?? '').toLowerCase();
    const path = (m[4] ?? '').replace(/[.,;:!?)\]}]+$/, '').replace(/^\/+/, '/') || '/';
    return { origin: `${scheme}://${host}:${port}`, secure: scheme === 'https', host, port, path };
  }
  return null;
}

/** Where a printed host listens. "localhost" can be either: Vite on Windows listens on ::1 only. */
function addressesOf(host: string): string[] {
  if (host === '[::1]') return ['::1'];
  if (host === '[::]') return ['::1', '127.0.0.1'];
  if (host === 'localhost') return ['127.0.0.1', '::1'];
  return ['127.0.0.1'];
}

function eachLine(stream: Readable | null, onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    const parts = pending.split(/\r\n|\r|\n/);
    pending = parts.pop() ?? '';
    if (pending.length > LINE_CHARS) {
      parts.push(pending);
      pending = '';
    }
    for (const part of parts) onLine(plainLine(part.slice(0, LINE_CHARS)));
  });
  stream.on('end', () => {
    if (pending) onLine(plainLine(pending));
    pending = '';
  });
}

/** The line that says most about why it stopped: the first that reads like an error, else the last one. */
function telling(lines: readonly string[]): string {
  const said = lines.map((line) => line.trim()).filter(Boolean);
  const error = said.find((line) => /\b(error|cannot|can't|not found|not recognized|failed|missing|denied|EADDRINUSE|in use)\b/i.test(line));
  const line = error ?? said.at(-1) ?? '';
  return line ? redactClip(line, 160) : '';
}

const seconds = (ms: number) => {
  const s = Math.round(ms / 100) / 10;
  return `${s} second${s === 1 ? '' : 's'}`;
};

function codeOf(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The proxy

interface Proxy {
  port: number;
  /** "http://127.0.0.1:<port>". */
  origin: string;
  /**
   * Also answers at https://<host>:<port>, where tailscale serve brings the tailnet in, to browsers that bring the key
   * it returns (PREVIEW_KEY in the query) or the cookie they got for it.
   */
  admit(host: string, port: number): string;
  close(): Promise<void>;
}

/** The query parameter that carries a preview's key, in the tailnet address the office shows (PreviewView.tailnetUrl). */
const PREVIEW_KEY = 'worklings-preview';

/** What a browser on the tailnet without the key or its cookie reads instead of the app. */
const SHUT_OUT = "To see this preview, open it from the Worklings office on this device: the office's link is what lets it in.";

/**
 * Headers a proxy adds, tailscale serve among them (it always adds X-Forwarded-For): a request that carries one came
 * from elsewhere, whatever its Host says (as src/hub/guards.ts reads them).
 */
const FORWARDING = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-funnel-request'];
const forwarded = (req: IncomingMessage) => FORWARDING.some((h) => req.headers[h] !== undefined);

/** A query parameter's name as the app would read it. */
function paramName(raw: string): string {
  try {
    return decodeURIComponent(raw.replaceAll('+', ' '));
  } catch {
    return raw; // not valid percent-encoding: compared as sent
  }
}

/** A path or address without the preview's key, and the values it carried. The query's other pairs stay as sent. */
function withoutKey(address: string): { address: string; keys: string[] } {
  const q = address.indexOf('?');
  if (q === -1) return { address, keys: [] };
  const keys: string[] = [];
  const kept = address
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      const eq = pair.indexOf('=');
      if (paramName(eq === -1 ? pair : pair.slice(0, eq)) !== PREVIEW_KEY) return true;
      keys.push(eq === -1 ? '' : pair.slice(eq + 1));
      return false;
    });
  return { address: kept.length > 0 ? `${address.slice(0, q)}?${kept.join('&')}` : address.slice(0, q), keys };
}

/** The address with the preview's key added to its query, before any fragment. */
function withKey(address: string, key: string): string {
  const hash = address.indexOf('#');
  const base = hash === -1 ? address : address.slice(0, hash);
  const glue = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&';
  return `${base}${glue}${PREVIEW_KEY}=${key}${hash === -1 ? '' : address.slice(hash)}`;
}

/** The values a Cookie header sends under `name`. */
function cookiesNamed(header: string | undefined, name: string): string[] {
  if (!header) return [];
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
}

/** Headers that belong to one connection, never passed on. Expect: Node has already answered 100 Continue. */
const HOP_BY_HOP: ReadonlySet<string> = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect']);
/**
 * What a browser attaches for the address rather than the app: cookies aren't kept apart by port, and the office's
 * token travels as Authorization. Cookies don't travel through the preview either way (responseHeaders drops
 * Set-Cookie), so an app with a cookie login won't stay signed in inside the preview: a limitation accepted for v3.
 */
const CREDENTIALS: ReadonlySet<string> = new Set(['cookie', 'authorization', 'proxy-authorization']);

/** The header names a Connection header lists, which are hop-by-hop too. */
function listedIn(raw: readonly string[]): Set<string> {
  const listed = new Set<string>();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if ((raw[i] ?? '').toLowerCase() !== 'connection') continue;
    for (const token of (raw[i + 1] ?? '').split(',')) listed.add(token.trim().toLowerCase());
  }
  return listed;
}

function sameOrigin(url: string, origins: ReadonlySet<string>): boolean {
  try {
    return origins.has(new URL(url).origin);
  } catch {
    return false; // not a URL at all
  }
}

/**
 * Request headers for the dev server: no hop-by-hop headers, no credentials (the preview's own cookie among them), none
 * of the headers tailscale serve adds about who is asking (Tailscale-User-Login, -Name, -Profile-Pic, the app
 * capabilities and the rest: the person's identity is not the app's business), and no referrer from another origin or
 * carrying the preview's key. A body that came chunked goes on chunked: Node frames a DELETE or OPTIONS body only when
 * told to. With `host`, the Host header becomes that: a request from the tailnet reaches the dev server under the
 * proxy's local name, the only kind a dev server that checks its Host (Vite does) takes.
 */
function requestHeaders(req: IncomingMessage, origins: ReadonlySet<string>, host: string | null = null): string[] {
  const raw = req.rawHeaders;
  const listed = listedIn(raw);
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const value = raw[i + 1] ?? '';
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || listed.has(key) || CREDENTIALS.has(key) || key.startsWith('tailscale-')) continue;
    if (key === 'referer' && (!sameOrigin(value, origins) || withoutKey(value).keys.length > 0)) continue;
    out.push(name, key === 'host' && host !== null ? host : value);
  }
  if (req.headers['transfer-encoding'] !== undefined && req.headers['content-length'] === undefined) out.push('Transfer-Encoding', 'chunked');
  return out;
}

/**
 * Response headers for the browser: no cookies (none travel through the preview either way), no hop-by-hop headers
 * except on a 101, and a redirect to the dev server's own address sent back through the proxy.
 */
function responseHeaders(raw: readonly string[], upgrade: boolean, relocate: (location: string) => string): string[] {
  const listed = upgrade ? new Set<string>() : listedIn(raw);
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const key = name.toLowerCase();
    if (key === 'set-cookie' || (!upgrade && (HOP_BY_HOP.has(key) || listed.has(key)))) continue;
    out.push(name, key === 'location' ? relocate(raw[i + 1] ?? '') : (raw[i + 1] ?? ''));
  }
  return out;
}

function headerLines(raw: readonly string[]): string {
  let text = '';
  for (let i = 0; i + 1 < raw.length; i += 2) text += `${raw[i]}: ${raw[i + 1]}\r\n`;
  return text;
}

function plainAnswer(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
}

function refuseUpgrade(socket: Duplex, status: number, text = ''): void {
  const body = Buffer.from(text, 'utf8');
  const type = text ? 'content-type: text/plain; charset=utf-8\r\n' : '';
  socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nconnection: close\r\n${type}content-length: ${body.length}\r\n\r\n`), body]));
}

/** The preview's tailnet address once it is served there: its Host headers, origin, key and cookie. */
interface TailnetSide {
  hosts: ReadonlySet<string>;
  /** "https://<host>:<port>". */
  origin: string;
  key: string;
  /** The cookie's name, which names the port: cookies don't keep ports apart, so each preview has its own. */
  cookie: string;
  /** The cookie's value. */
  pass: string;
}

const hasPass = (req: IncomingMessage, t: TailnetSide) => cookiesNamed(req.headers.cookie, t.cookie).some((value) => sameToken(value, t.pass));

/**
 * The key traded for the preview's cookie, or a request with the cookie that still carries a key: the browser goes on
 * to the same address without it, so the key leaves the address bar before the app loads and is never a referrer.
 */
function onWithoutKey(res: ServerResponse, location: string, t: TailnetSide, trade: boolean): void {
  try {
    res.writeHead(303, {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-length': '0',
      // __Host-: only this host sets or gets it, over https, for every path.
      ...(trade ? { 'set-cookie': `${t.cookie}=${t.pass}; Path=/; Secure; HttpOnly; SameSite=Strict` } : {}),
    });
  } catch {
    // A path with a character no header may hold: Node's parser turns those away first, unless it runs with
    // --insecure-http-parser, and the throw would otherwise take the hub down.
    return plainAnswer(res, 400, "The preview can't send the browser to that address.");
  }
  res.end();
}

const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]']);

/** Opens the proxy on 127.0.0.1 at a free port, in front of `target` (an address the dev server answers on). */
function openProxy(target: { host: string; port: number }): Promise<Proxy> {
  const agent = new Agent({ keepAlive: true });
  const tunnels = new Set<Duplex>();
  let own: ReadonlySet<string> = new Set();
  let origins: ReadonlySet<string> = new Set();
  let origin = '';
  let local = '';
  /** Once the proxy is served on the tailnet. */
  let tailnet: TailnetSide | null = null;

  /**
   * Where a request comes from: this computer (a loopback Host and nothing forwarded, as before), the tailnet (its Host,
   * or anything forwarded, since tailscale serve passes the phone's own Host through), or nowhere it answers (null).
   */
  const sideOf = (req: IncomingMessage): { side: 'local' } | { side: 'tailnet'; t: TailnetSide } | null => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (tailnet !== null && (tailnet.hosts.has(host) || (own.has(host) && forwarded(req)))) return { side: 'tailnet', t: tailnet };
    return own.has(host) && !forwarded(req) ? { side: 'local' } : null;
  };
  const track = (socket: Duplex) => {
    tunnels.add(socket);
    socket.once('close', () => tunnels.delete(socket));
  };
  /** A redirect to the dev server's own address, sent back to the origin the request came in on. */
  const relocate = (base: string) => (location: string): string => {
    let url: URL;
    try {
      url = new URL(location);
    } catch {
      return location; // a relative redirect stays on the proxy by itself
    }
    if (url.protocol !== 'http:' || !LOOPBACK_NAMES.has(url.hostname) || Number(url.port || 80) !== target.port) return location;
    return `${base}${url.pathname}${url.search}${url.hash}`;
  };
  /** Where a request came in: its origin for redirects, and the Host the dev server gets (its own name for the tailnet's). */
  const via = (from: NonNullable<ReturnType<typeof sideOf>>) => (from.side === 'tailnet' ? { base: from.t.origin, host: local } : { base: origin, host: null });

  const server = createServer((req, res) => {
    const from = sideOf(req);
    if (from === null) return plainAnswer(res, 403, `This preview answers only at ${origin}/.`);
    const path = req.url ?? '';
    // A browser sends a path; a full address ("GET http://elsewhere/") would make the proxy an open one.
    if (!path.startsWith('/')) return plainAnswer(res, 400, 'The preview forwards paths only.');
    if (from.side === 'tailnet') {
      const { address, keys } = withoutKey(path);
      const passed = hasPass(req, from.t);
      if (keys.length > 0) {
        const traded = keys.some((key) => sameToken(key, from.t.key));
        // Absolute, on the preview's own origin: a path like //elsewhere stays a path. A browser trades the key once.
        if (traded || passed) return onWithoutKey(res, `${from.t.origin}${address}`, from.t, traded && !passed);
      }
      if (!passed) return plainAnswer(res, 403, SHUT_OUT);
    }
    const came = via(from);
    const upstream = request({ host: target.host, port: target.port, method: req.method, path, headers: requestHeaders(req, origins, came.host), agent }, (up) => {
      try {
        res.writeHead(up.statusCode ?? 502, responseHeaders(up.rawHeaders, false, relocate(came.base)));
      } catch {
        up.destroy();
        return plainAnswer(res, 502, "The app answered with headers the preview can't pass on.");
      }
      up.on('error', () => res.destroy());
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (res.headersSent || res.destroyed) res.destroy();
      else plainAnswer(res, 502, "The app didn't answer.");
    });
    // The browser went away before the answer ended: stop asking the dev server too.
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    const from = sideOf(req);
    if (from === null) return refuseUpgrade(socket, 403);
    let path = req.url ?? '';
    if (!path.startsWith('/') || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return refuseUpgrade(socket, 400);
    if (from.side === 'tailnet') {
      // A WebSocket can't follow a redirect: only the cookie lets it in, and a key it carries stays here.
      if (!hasPass(req, from.t)) return refuseUpgrade(socket, 403, SHUT_OUT);
      path = withoutKey(path).address;
    }
    track(socket);
    let upgraded = false;
    const came = via(from);
    const headers = [...requestHeaders(req, origins, came.host), 'Connection', 'Upgrade', 'Upgrade', 'websocket'];
    const upstream = request({ host: target.host, port: target.port, method: req.method, path, headers, agent: false });
    upstream.on('upgrade', (up, upSocket: Duplex, upHead: Buffer) => {
      upgraded = true;
      track(upSocket);
      upSocket.on('error', () => upSocket.destroy());
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines(responseHeaders(up.rawHeaders, true, relocate(came.base)))}\r\n`);
      if (upHead.length > 0) socket.write(upHead);
      if (head.length > 0) upSocket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      upSocket.on('close', () => socket.destroy());
      socket.on('close', () => upSocket.destroy());
    });
    // The dev server turned the upgrade down: pass its answer on, then close.
    upstream.on('response', (up) => {
      const status = up.statusCode ?? 502;
      socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\n${headerLines(responseHeaders(up.rawHeaders, false, relocate(came.base)))}connection: close\r\n\r\n`);
      up.on('error', () => socket.destroy());
      up.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (!upgraded) upstream.destroy();
    });
    upstream.end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        reject(new Error('The preview proxy has no port.'));
        return;
      }
      const port = address.port;
      own = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      origin = `http://127.0.0.1:${port}`;
      local = `127.0.0.1:${port}`;
      origins = new Set([origin, `http://localhost:${port}`]);
      resolve({
        port,
        origin,
        admit(host, https) {
          const name = host.toLowerCase();
          // Browsers leave the port out of Host for 443 and put it in for any other.
          const at = https === 443 ? `https://${name}` : `https://${name}:${https}`;
          const key = randomBytes(32).toString('base64url');
          tailnet = {
            hosts: new Set(https === 443 ? [name, `${name}:443`] : [`${name}:${https}`]),
            origin: at,
            key,
            cookie: `__Host-worklings-preview-${https}`,
            pass: randomBytes(32).toString('base64url'),
          };
          origins = new Set([...origins, at]);
          return key;
        },
        close: () =>
          new Promise((done) => {
            for (const socket of tunnels) socket.destroy();
            agent.destroy();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** Whether something accepts a connection at host:port. Never rejects. */
function answers(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: PROBE_MS });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Running it

/** Kills the process and everything it started: taskkill /T on Windows, the process group elsewhere. Never rejects. */
function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  const running = child.exitCode === null && child.signalCode === null;
  if (process.platform !== 'win32') {
    // The group can outlive its leader (a server that npm's shell left behind), so it goes even after npm has exited.
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      if (running) child.kill('SIGKILL');
    }
    return Promise.resolve();
  }
  if (!running) return Promise.resolve();
  // The full path, so a taskkill.exe in the project folder can't stand in for it.
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise((done) => {
    execFile(taskkill, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: TASKKILL_MS }, (error) => {
      // taskkill fails when the process ended a moment ago, or when it couldn't run: then stop the process itself.
      if (error) child.kill();
      done();
    });
  });
}

/** Resolves when the process has exited, or after `ms` when it hasn't. */
function exited(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}

function startFailure(error: unknown, command: string): string {
  const code = codeOf(error);
  if (code === 'ENOENT') return `The office couldn't find npm to run ${command}.`;
  if (code === 'EACCES' || code === 'EPERM') return `The office isn't allowed to run npm for ${command}.`;
  return `The office couldn't start ${command}${code ? ` (${code})` : ''}.`;
}

type State = PreviewView['state'];

interface Run {
  companyId: string;
  root: string;
  command: string | null;
  state: State;
  url: string | null;
  problem: string | null;
  dependencies: boolean;
  child: ChildProcess | null;
  proxy: Proxy | null;
  /** Stops the clock that gives up on it, while it runs. */
  stopClock: (() => void) | null;
  /** The address the dev command printed, once it has. */
  address: LocalAddress | null;
  lines: string[];
  /** Its entry on the tailnet while --tailnet is on and it is up, and the app's address there, with its key. */
  tailnet: { stop(): Promise<void> } | null;
  tailnetUrl: string | null;
  /** Set once the run is being taken down; resolves when its processes and its proxy are gone. */
  ending: Promise<void> | null;
}

const OFF: PreviewView = Object.freeze({ state: 'off', url: null, command: null, problem: null });

/** What went wrong, as words for the terminal: a TailnetError's sentence says what to do. */
const said = (error: unknown) => (error instanceof Error ? error.message : String(error));
const warn = (line: string) => void process.stderr.write(`worklings: ${line}\n`);

export function createPreviews(o: PreviewOptions = {}): Previews {
  const startProcess: StartProcess = o.spawn ?? ((command, args, options) => spawn(command, args, options));
  const now = o.now ?? Date.now;
  const timeoutMs = o.startTimeoutMs ?? START_TIMEOUT_MS;
  const deadline =
    o.deadline ??
    ((giveUp: () => void, ms: number) => {
      const timer = setTimeout(giveUp, ms);
      return () => clearTimeout(timer);
    });
  const runs = new Map<string, Run>();
  const detections = new Map<string, { at: number; found: Detection }>();

  const isCurrent = (run: Run) => runs.get(run.companyId) === run;
  const starting = (run: Run) => isCurrent(run) && run.state === 'starting' && run.ending === null;
  const viewOf = (run: Run): PreviewView => ({
    state: run.state,
    url: run.state === 'up' ? run.url : null,
    command: run.command,
    problem: run.state === 'down' ? run.problem : null,
    ...(run.state === 'up' && run.tailnetUrl ? { tailnetUrl: run.tailnetUrl } : {}),
  });

  function detect(root: string, fresh: boolean): Detection {
    const kept = detections.get(root);
    if (!fresh && kept && now() - kept.at < DETECT_TTL_MS) return kept.found;
    const found = devScript(root);
    detections.set(root, { at: now(), found });
    return found;
  }

  function changed(run: Run): void {
    if (!isCurrent(run) || !o.onChange) return;
    try {
      o.onChange(run.companyId);
    } catch (error) {
      // The hub's listener runs inside a child process's events here: report it rather than take the hub down.
      process.stderr.write(`worklings: the preview's change listener failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  /** Takes a run down: the dev command's whole tree and the proxy. Safe to call more than once. */
  function end(run: Run): Promise<void> {
    run.stopClock?.();
    run.stopClock = null;
    run.ending ??= (async () => {
      const child = run.child;
      const entry = run.tailnet;
      run.tailnet = null;
      run.tailnetUrl = null;
      // Off the tailnet first, so a phone isn't led to a port that is closing.
      await entry?.stop().catch((error: unknown) => warn(`couldn't take the preview off your tailnet: ${said(error)}`));
      await Promise.all([child ? killTree(child) : null, child ? exited(child, KILL_WAIT_MS) : null, run.proxy?.close()]);
      run.proxy = null;
      child?.stdin?.destroy();
      child?.stdout?.destroy();
      child?.stderr?.destroy();
    })();
    return run.ending;
  }

  function fail(run: Run, problem: string): void {
    if (!isCurrent(run) || run.ending) return;
    run.state = 'down';
    run.url = null;
    run.problem = problem;
    changed(run);
    void end(run);
  }

  const installHint = (run: Run) => (run.dependencies && !isFolder(join(run.root, 'node_modules')) ? ' Run npm install in the project first.' : '');

  function onExit(run: Run, code: number | null, signal: NodeJS.Signals | null): void {
    if (!isCurrent(run) || run.ending) return;
    const said = telling(run.lines);
    const quoted = said ? `: ${said}` : '.';
    const how = code === null ? `was stopped (${signal ?? 'by a signal'})` : `stopped with exit code ${code}`;
    if (run.state === 'up') return fail(run, `The app ${how}${quoted}`);
    if (code === 0) return fail(run, `${run.command} ended before the app was up, so there's nothing to preview${quoted}`);
    fail(run, `${run.command} ${how} before the app was up${quoted}${installHint(run)}`);
  }

  function onLine(run: Run, line: string): void {
    if (line.trim()) {
      run.lines.push(line);
      if (run.lines.length > KEPT_LINES) run.lines.shift();
    }
    if (!starting(run) || run.address) return;
    const address = localAddress(line);
    if (!address) return;
    run.address = address;
    if (address.secure) return fail(run, `${run.command} serves ${address.origin}${address.path}, but the preview needs plain http, so the office stopped it.`);
    void reach(run, address);
  }

  function onTimeout(run: Run): void {
    if (!starting(run)) return;
    const within = seconds(timeoutMs);
    if (run.address) {
      return fail(run, `${run.command} printed ${run.address.origin}${run.address.path}, but nothing answered there within ${within}, so the office stopped it.`);
    }
    const said = telling(run.lines);
    fail(run, `${run.command} printed no local address within ${within}, so the office stopped it.${said ? ` It last printed: ${said}` : ''}`);
  }

  /** Finds where the printed address answers, then opens the proxy in front of it. Never rejects. */
  async function reach(run: Run, address: LocalAddress): Promise<void> {
    let host: string | null = null;
    while (host === null && starting(run)) {
      for (const candidate of addressesOf(address.host)) {
        if (await answers(candidate, address.port)) {
          host = candidate;
          break;
        }
      }
      if (host === null && starting(run)) await delay(PROBE_EVERY_MS);
    }
    // Not reached: the timeout or a stop has the say.
    if (host === null || !starting(run)) return;
    let proxy: Proxy;
    try {
      proxy = await openProxy({ host, port: address.port });
    } catch (error) {
      return fail(run, `The office couldn't open a port for the preview${codeOf(error) ? ` (${codeOf(error)})` : ''}.`);
    }
    if (!starting(run)) return proxy.close();
    run.proxy = proxy;
    run.stopClock?.();
    run.stopClock = null;
    run.state = 'up';
    run.url = `${proxy.origin}${address.path}`;
    changed(run);
    await serveOnTailnet(run, proxy, address.path);
  }

  /** With --tailnet, the app at an https port of its own on the ts.net name too, for a phone. Never rejects. */
  async function serveOnTailnet(run: Run, proxy: Proxy, path: string): Promise<void> {
    const tailnet = o.tailnet?.() ?? null;
    if (!tailnet) return;
    let entry: Awaited<ReturnType<PreviewTailnet['serve']>>;
    try {
      entry = await tailnet.serve(proxy.port);
    } catch (error) {
      // The preview still works on this computer; only the phone goes without it.
      return warn(`couldn't put the preview on your tailnet: ${said(error)}`);
    }
    if (!isCurrent(run) || run.state !== 'up' || run.proxy !== proxy || run.ending) {
      await entry.stop().catch((error: unknown) => warn(`couldn't take the preview off your tailnet: ${said(error)}`));
      return;
    }
    const key = proxy.admit(entry.host, entry.port);
    run.tailnet = entry;
    // Only token holders see the view, so only they get the key.
    run.tailnetUrl = withKey(`${entry.url.replace(/\/$/, '')}${path}`, key);
    changed(run);
  }

  function launch(run: Run, npm: NpmLookup, script: string): void {
    if (!starting(run) || run.command === null) return;
    let child: ChildProcess;
    try {
      child = startProcess(npm.command, [...npm.args, 'run', '--silent', script], {
        cwd: run.root,
        env: devEnv(o.env ?? process.env),
        shell: false,
        windowsHide: true,
        // Its own process group off Windows, so stopping can kill everything it started; Windows uses taskkill /T.
        detached: process.platform !== 'win32',
        // stdin stays open and unused: some dev servers (Create React App's) quit when it ends.
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      return fail(run, startFailure(error, run.command));
    }
    run.child = child;
    const command = run.command;
    // Nothing is ever written to stdin; the pipe's error when the process goes says nothing the exit doesn't.
    child.stdin?.on('error', () => undefined);
    child.on('error', (error) => fail(run, startFailure(error, command)));
    // 'exit' can come before the last of its output, which the problem quotes: wait for the pipes to close, or a moment
    // when something it started keeps them open.
    child.once('exit', (code, signal) => {
      const timer = setTimeout(() => onExit(run, code, signal), EXIT_GRACE_MS);
      child.once('close', () => {
        clearTimeout(timer);
        onExit(run, code, signal);
      });
    });
    eachLine(child.stdout, (line) => onLine(run, line));
    eachLine(child.stderr, (line) => onLine(run, line));
    run.stopClock = deadline(() => onTimeout(run), timeoutMs);
  }

  function start(companyId: string, root: string): PreviewView {
    const before = runs.get(companyId);
    if (before && before.ending === null && (before.state === 'starting' || before.state === 'up')) return viewOf(before);
    const found = detect(root, true);
    const run: Run = {
      companyId,
      root,
      command: found.ok ? found.dev.command : null,
      state: 'starting',
      url: null,
      problem: null,
      dependencies: found.ok && found.dev.dependencies,
      child: null,
      proxy: null,
      stopClock: null,
      address: null,
      lines: [],
      tailnet: null,
      tailnetUrl: null,
      ending: null,
    };
    runs.set(companyId, run);
    if (!found.ok) {
      fail(run, found.problem);
      return viewOf(run);
    }
    const npm = findNpm(o.env ?? process.env);
    if (!npm) {
      fail(run, `The office couldn't find npm beside Node or on the PATH, so it can't run ${found.dev.command}.`);
      return viewOf(run);
    }
    // The previous run goes first, so the new dev server doesn't find the old one still on its port.
    void (before ? end(before) : Promise.resolve()).then(() => launch(run, npm, found.dev.script));
    return viewOf(run);
  }

  async function stop(companyId: string): Promise<PreviewView> {
    const run = runs.get(companyId);
    if (!run) return OFF;
    run.state = 'off';
    run.url = null;
    run.problem = null;
    await end(run);
    changed(run);
    return viewOf(run);
  }

  function view(companyId: string, root?: string): PreviewView {
    const run = runs.get(companyId);
    if (run && run.state !== 'off') return viewOf(run);
    if (root === undefined) return { ...OFF, command: run?.command ?? null };
    const found = detect(root, false);
    return { ...OFF, command: found.ok ? found.dev.command : null };
  }

  async function closeAll(): Promise<void> {
    await Promise.all([...runs.keys()].map((id) => stop(id)));
  }

  return { start, stop, view, closeAll };
}
