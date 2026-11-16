import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PreviewView } from '../src/core/company.ts';
import { createPreviews, devScript, findNpm, localAddress, plainLine, type Previews, type PreviewTailnet } from '../src/server/preview.ts';
import { tempDir } from './library-kit.ts';

const FAKE = fileURLToPath(new URL('./preview-dev-server.mjs', import.meta.url));

// Deadlines, sized for npm starting and taskkill ending process trees on a machine busy with other test runs (npm
// takes about a second when it's quiet). Each wait ends as soon as what it waits for happens.
/** For a preview to be up or down. */
const SETTLE_MS = 45_000;
/** For processes to end after a stop. */
const GONE_MS = 45_000;
/** For a test or hook that starts dev servers, some two of them. */
const TEST_MS = 120_000;

/** `promise`, or a failure saying what didn't happen once `ms` have passed first. */
function within<T>(promise: Promise<T>, ms: number, what: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what())), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Lifelines: every fake dev server, and the process it starts, connects here once it runs, waits for an answer before it
// prints anything, and holds the connection, so a test sees it start, and sees it end when the system closes the
// connection, as events.

interface Fake {
  /** The name of its project's folder. */
  project: string;
  role: 'server' | 'child';
  pid: number;
  /** Where it listens, for a server that serves. */
  port: number | null;
  /** Resolves once the process has gone. */
  gone: Promise<void>;
  ended: boolean;
}

const fakes: Fake[] = [];
const arrivals = new Set<() => void>();
let lifelinePort = 0;

const lifelines = createNetServer((socket) => {
  let text = '';
  let fake: Fake | null = null;
  const gone = new Promise<void>((resolve) =>
    socket.once('close', () => {
      if (fake) fake.ended = true;
      resolve();
    }),
  );
  socket.setEncoding('utf8');
  socket.on('error', () => socket.destroy());
  socket.on('data', (chunk: string) => {
    text += chunk;
    const newline = text.indexOf('\n');
    if (fake || newline === -1) return;
    const hello = JSON.parse(text.slice(0, newline)) as Pick<Fake, 'project' | 'role' | 'pid' | 'port'>;
    fake = { ...hello, gone, ended: false };
    fakes.push(fake);
    for (const arrive of [...arrivals]) arrive();
    // Only now does the fake print anything, so the office can't stop it before the test knows it ran.
    socket.write('ok\n');
  });
});

beforeAll(async () => {
  lifelines.listen(0, '127.0.0.1');
  await once(lifelines, 'listening');
  const address = lifelines.address();
  lifelinePort = typeof address === 'object' && address ? address.port : 0;
});

afterAll(async () => {
  try {
    await within(Promise.all(fakes.map((f) => f.gone)), GONE_MS, () => {
      const left = fakes.filter((f) => !f.ended).map((f) => `the ${f.role} ${f.pid} in ${f.project}`);
      return `Fake dev servers still running after the tests: ${left.join(', ')}.`;
    });
  } finally {
    lifelines.close();
  }
}, TEST_MS);

/** The fake running in this project, once it has connected. */
function fakeOf(root: string, role: Fake['role'] = 'server'): Promise<Fake> {
  const project = basename(root);
  let look = () => {};
  const found = new Promise<Fake>((resolve) => {
    look = () => {
      const fake = fakes.find((f) => f.project === project && f.role === role);
      if (fake) resolve(fake);
    };
    arrivals.add(look);
    look();
  });
  return within(found, SETTLE_MS, () => `The fake dev server's ${role} in ${project} never got going.`).finally(() => arrivals.delete(look));
}

/** Resolves once the process has exited: at once when it already has. */
const exitOf = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit').then(() => undefined);

/** A project whose package.json has these scripts (none: no package.json), with the fake dev server in its folder. */
function project(scripts: Record<string, string> | null, extra: Record<string, unknown> = {}): string {
  const root = tempDir('worklings-preview-');
  copyFileSync(FAKE, join(root, 'preview-dev-server.mjs'));
  if (scripts) writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fake-app', private: true, scripts, ...extra }));
  return root;
}

const fakeDev = (mode: string) => ({ dev: `node preview-dev-server.mjs ${mode} ${lifelinePort}` });

interface Started {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
  child: ChildProcess;
}

/** Each test's previews, closed after it; a suite that shares one preview closes it itself. */
const opened: Previews[] = [];

/**
 * Previews that record what they start and when they change, with npm's cache and logs in a temp folder rather than
 * the real home. With `deadline`, the test says when a dev command's time is up.
 */
function previewsFor(o: { shared?: boolean; deadline?: (giveUp: () => void, ms: number) => () => void; tailnet?: PreviewTailnet } = {}) {
  const started: Started[] = [];
  const changes: string[] = [];
  const waiters = new Set<() => void>();
  const previews = createPreviews({
    env: { ...process.env, npm_config_cache: tempDir('worklings-npm-'), npm_config_logs_max: '0' },
    deadline: o.deadline,
    ...(o.tailnet ? { tailnet: () => o.tailnet ?? null } : {}),
    onChange: (id) => {
      changes.push(id);
      for (const waiter of [...waiters]) waiter();
    },
    spawn: (command, args, options) => {
      const child = spawn(command, args, options);
      started.push({ command, args, options, child });
      return child;
    },
  });
  if (!o.shared) opened.push(previews);
  /** The preview once it is up or down, as soon as it says so. */
  const settled = (id: string): Promise<PreviewView> => {
    let look = () => {};
    const done = new Promise<PreviewView>((resolve) => {
      look = () => {
        const view = previews.view(id);
        if (view.state !== 'starting') resolve(view);
      };
      waiters.add(look);
      look();
    });
    return within(done, SETTLE_MS, () => `The preview of ${id} was still starting after ${SETTLE_MS / 1000} seconds.`).finally(() => waiters.delete(look));
  };
  return { previews, started, changes, settled };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((p) => p.closeAll()));
}, TEST_MS);

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A request as a browser sends it: a body has its Content-Length, or with `chunked` comes in pieces. */
function call(url: string, o: { method?: string; headers?: Record<string, string>; body?: string; chunked?: boolean } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const length: Record<string, string> = o.body === undefined ? {} : o.chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': String(Buffer.byteLength(o.body)) };
    const req = request(url, { method: o.method ?? 'GET', headers: { ...length, ...o.headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (o.body !== undefined && o.chunked) {
      const half = Math.floor(o.body.length / 2);
      req.write(o.body.slice(0, half));
      req.end(o.body.slice(half));
    } else {
      req.end(o.body);
    }
  });
}

/** The status a WebSocket handshake gets with this Host header, and any others. */
function handshake(url: string, host: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: { host, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13', ...headers },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/** What a raw request line gets, for what a browser never sends. */
function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let answer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      answer += chunk;
      if (answer.includes('\r\n\r\n')) socket.destroy();
    });
    socket.on('close', () => resolve(answer));
    socket.on('error', reject);
    socket.write(text);
  });
}

function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

const portOf = (url: string | null) => Number(new URL(url ?? '').port);

describe('the dev command', () => {
  it('is the dev script, else the start script, named as the office shows it', () => {
    expect(devScript(project({ dev: 'vite', start: 'node server.js' }))).toEqual({ ok: true, dev: { script: 'dev', command: 'npm run dev', dependencies: false } });
    expect(devScript(project({ start: 'node server.js' }, { dependencies: { express: '^5.0.0' } }))).toEqual({
      ok: true,
      dev: { script: 'start', command: 'npm run start', dependencies: true },
    });
  });

  it('is missing, with the reason, when package.json has neither script, is absent or is broken', () => {
    expect(devScript(project({ build: 'vite build', dev: '  ' }))).toEqual({ ok: false, problem: "The project's package.json has no dev or start script, so there's no app to start." });
    expect(devScript(project(null))).toEqual({ ok: false, problem: "The project has no package.json, so there's no app the office knows how to start." });
    const broken = project(null);
    writeFileSync(join(broken, 'package.json'), '{"scripts": {"dev": ');
    expect(devScript(broken)).toEqual({ ok: false, problem: "The project's package.json isn't valid JSON, so the office can't tell how to start the app." });
    expect(devScript(join(broken, 'gone'))).toEqual({ ok: false, problem: `The project folder isn't at ${join(broken, 'gone')} any more.` });
  });

  it('reads a package.json that starts with a byte-order mark, and no script from its prototype', () => {
    const root = project(null);
    writeFileSync(join(root, 'package.json'), `\uFEFF${JSON.stringify({ scripts: { dev: 'astro dev' } })}`);
    expect(devScript(root)).toMatchObject({ ok: true, dev: { command: 'npm run dev' } });
    const odd = project(null);
    writeFileSync(join(odd, 'package.json'), '{"scripts": {"__proto__": {"dev": "evil"}}}');
    expect(devScript(odd).ok).toBe(false);
  });

  it('shows on a preview that is off, before anything runs', () => {
    const { previews, started } = previewsFor();
    expect(previews.view('plant-pal', project({ dev: 'vite' }))).toEqual({ state: 'off', url: null, command: 'npm run dev', problem: null });
    expect(previews.view('no-app', project({ build: 'tsc' }))).toEqual({ state: 'off', url: null, command: null, problem: null });
    expect(previews.view('unknown')).toEqual({ state: 'off', url: null, command: null, problem: null });
    expect(started).toEqual([]);
  });
});

describe('finding npm', () => {
  const files = (...paths: string[]) => (file: string) => paths.includes(file);

  it("uses npm's CLI script beside this Node on Windows, since npm.cmd needs a shell", () => {
    const cli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    expect(findNpm({ PATH: '' }, 'win32', files(cli), 'C:\\Program Files\\nodejs\\node.exe')).toEqual({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [cli] });
  });

  it('finds the CLI script beside an npm.cmd on the PATH, skipping relative entries', () => {
    const cli = 'C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    const exists = files('C:\\nvm4w\\nodejs\\npm.cmd', cli, 'tools\\npm.cmd', 'tools\\node_modules\\npm\\bin\\npm-cli.js');
    expect(findNpm({ Path: 'tools;"C:\\nvm4w\\nodejs"' }, 'win32', exists, 'C:\\Node\\node.exe')).toEqual({ command: 'C:\\Node\\node.exe', args: [cli] });
  });

  it('runs a POSIX npm through its CLI script, or as it is when it lives outside a Node install', () => {
    expect(findNpm({ PATH: '/usr/bin' }, 'linux', files('/usr/local/lib/node_modules/npm/bin/npm-cli.js'), '/usr/local/bin/node')).toEqual({
      command: '/usr/local/bin/node',
      args: ['/usr/local/lib/node_modules/npm/bin/npm-cli.js'],
    });
    expect(findNpm({ PATH: '/home/kai/.volta/bin' }, 'darwin', files('/home/kai/.volta/bin/npm'), '/opt/node/bin/node')).toEqual({ command: '/home/kai/.volta/bin/npm', args: [] });
  });

  it('is null when there is no npm', () => {
    expect(findNpm({ PATH: 'C:\\Windows' }, 'win32', files(), 'C:\\Node\\node.exe')).toBeNull();
  });
});

describe('reading the address a dev server prints', () => {
  it('takes the first local address, without the colours Vite prints even into a pipe', () => {
    const vite = '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m';
    expect(plainLine(vite)).toBe('  ➜  Local:   http://localhost:5173/');
    expect(localAddress(plainLine(vite))).toEqual({ origin: 'http://localhost:5173', secure: false, host: 'localhost', port: 5173, path: '/' });
  });

  it.each([
    ['   - Local:        http://localhost:3000', 'http://localhost:3000', '/'],
    ['┃ Local    http://localhost:4321/docs/', 'http://localhost:4321', '/docs/'],
    ['<i> [webpack-dev-server] Loopback: http://localhost:8080/, http://[::1]:8080/', 'http://localhost:8080', '/'],
    ['› Web is waiting on http://localhost:8081', 'http://localhost:8081', '/'],
    ['[wrangler:info] Ready on http://127.0.0.1:8787', 'http://127.0.0.1:8787', '/'],
    ['Listening on http://[::1]:5000 (and http://0.0.0.0:5000).', 'http://[::1]:5000', '/'],
    ['Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...', 'http://0.0.0.0:8000', '/'],
  ])('reads %j', (line, origin, path) => {
    expect(localAddress(line)).toMatchObject({ origin, path });
  });

  it("ignores what isn't a local http address with a port", () => {
    for (const line of [
      'Debugger listening on ws://127.0.0.1:9229/0f4ce5e5',
      'Docs: https://vite.dev/guide/',
      'Network: http://192.168.1.5:5173/',
      'open http://localhost/ in a browser',
      'port http://localhost:0/ and http://localhost:99999/',
      'xhttp://localhost:3000/',
    ]) {
      expect(localAddress(line)).toBeNull();
    }
    expect(localAddress('https://localhost:5173/')).toMatchObject({ secure: true });
  });

  it('drops links and other escapes a terminal would hide', () => {
    expect(plainLine('\u001b]8;;http://localhost:3000/\u001b\\http://localhost:3000/\u001b]8;;\u001b\\ ready\u001b(B')).toBe('http://localhost:3000/ ready');
  });
});

describe('a preview that is up', () => {
  let root = '';
  let previews: Previews;
  let started: Started[];
  let changes: string[];
  let url = '';
  let port = 0;

  beforeAll(async () => {
    root = project(fakeDev('serve'));
    const made = previewsFor({ shared: true });
    ({ previews, started, changes } = made);
    expect(previews.start('cafe', root)).toEqual({ state: 'starting', url: null, command: 'npm run dev', problem: null });
    const view = await made.settled('cafe');
    expect(view).toMatchObject({ state: 'up', command: 'npm run dev', problem: null });
    url = view.url ?? '';
    port = portOf(view.url);
  }, TEST_MS);

  afterAll(async () => {
    await previews.closeAll();
  }, TEST_MS);

  it('serves the app at a port of its own on 127.0.0.1, and says so', async () => {
    const fake = await fakeOf(root);
    expect(url).toBe(`http://127.0.0.1:${port}/`);
    expect(port).not.toBe(fake.port);
    expect(changes).toContain('cafe');
    const page = await call(url);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Hello from the fake app');
  });

  it('runs npm in the project folder without a shell', () => {
    expect(started).toHaveLength(1);
    const [run] = started;
    expect(run?.options).toMatchObject({ cwd: root, shell: false });
    expect(run?.args.slice(-3)).toEqual(['run', '--silent', 'dev']);
    if (process.platform === 'win32') expect(run).toMatchObject({ command: process.execPath, args: [expect.stringMatching(/npm-cli\.js$/), 'run', '--silent', 'dev'] });
  });

  it('gives the same preview to a second start, without a second dev server', () => {
    expect(previews.start('cafe', root)).toEqual({ state: 'up', url, command: 'npm run dev', problem: null });
    expect(started).toHaveLength(1);
  });

  it('forwards every method with its path, query and body', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const answer = await call(`${url}echo?step=2&name=K%C3%A4the`, { method, body: method === 'GET' ? undefined : `{"method":"${method}"}`, headers: { 'content-type': 'application/json' } });
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toMatchObject({ method, url: '/echo?step=2&name=K%C3%A4the', body: method === 'GET' ? '' : `{"method":"${method}"}` });
    }
  });

  it('passes on a body that comes in pieces, whatever the method', async () => {
    for (const method of ['POST', 'DELETE', 'OPTIONS']) {
      const answer = await call(`${url}echo`, { method, body: '{"pieces":["one","two"]}', chunked: true });
      expect(JSON.parse(answer.body)).toMatchObject({ method, body: '{"pieces":["one","two"]}' });
    }
  });

  it('passes a WebSocket upgrade through for hot reload, both ways', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
    const heard: string[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('message', (event) => {
        heard.push(String(event.data));
        if (heard.length === 1) socket.send('ping');
        if (heard.length === 2) resolve();
      });
      socket.addEventListener('error', () => reject(new Error('The WebSocket through the proxy failed.')));
    });
    socket.close();
    expect(heard).toEqual(['hello', 'echo: ping']);
  });

  it("doesn't pass on cookies, credentials or another origin's referrer, and sets no cookie", async () => {
    const answer = await call(`${url}echo`, {
      headers: {
        cookie: 'office=1',
        authorization: 'Bearer office-token',
        'proxy-authorization': 'Basic b2ZmaWNlOnRva2Vu',
        referer: 'http://127.0.0.1:9/office?token=office-token',
        'x-app': 'kept',
      },
    });
    const seen = (JSON.parse(answer.body) as { headers: Record<string, string> }).headers;
    expect(seen).not.toHaveProperty('cookie');
    expect(seen).not.toHaveProperty('authorization');
    expect(seen).not.toHaveProperty('proxy-authorization');
    expect(seen).not.toHaveProperty('referer');
    expect(seen).toMatchObject({ host: `127.0.0.1:${port}`, 'x-app': 'kept' });
    expect(answer.headers).not.toHaveProperty('set-cookie');
    expect(answer.headers).not.toHaveProperty('access-control-allow-origin');
    const own = await call(`${url}echo`, { headers: { referer: `${url}menu` } });
    expect((JSON.parse(own.body) as { headers: Record<string, string> }).headers.referer).toBe(`${url}menu`);
  });

  it("refuses a Host that isn't its own address, upgrades included", async () => {
    for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`]) {
      const answer = await call(`${url}echo`, { headers: { host } });
      expect(answer).toMatchObject({ status: 403, body: `This preview answers only at http://127.0.0.1:${port}/.` });
      expect(await handshake(`${url}hmr`, host)).toBe(403);
    }
    expect((await call(`${url}echo`, { headers: { host: `localhost:${port}` } })).status).toBe(200);
    expect(await handshake(`${url}hmr`, `127.0.0.1:${port}`)).toBe(101);
  });

  it('turns away a forwarded request while it is not on the tailnet, whatever its Host says', async () => {
    // What a tailscale serve entry an earlier run left behind would send: the hub took the preview off the tailnet, or never put it there.
    const forwardedHere = { host: `127.0.0.1:${port}`, 'x-forwarded-for': '100.64.0.7' };
    expect(await call(`${url}echo`, { headers: forwardedHere })).toMatchObject({ status: 403, body: `This preview answers only at http://127.0.0.1:${port}/.` });
    expect(await handshake(`${url}hmr`, forwardedHere.host, { 'x-forwarded-for': forwardedHere['x-forwarded-for'] })).toBe(403);
  });

  it('forwards only to the dev server, never to an address in the request line', async () => {
    const answer = await rawRequest(port, `GET http://example.com/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
    expect(answer).toMatch(/^HTTP\/1\.1 400 /);
  });

  it("sends a redirect to the dev server's own address back through the proxy", async () => {
    const answer = await call(`${url}moved`);
    expect(answer).toMatchObject({ status: 302, headers: { location: `http://127.0.0.1:${port}/echo?from=moved` } });
  });
});

describe('a preview on the tailnet', () => {
  const NAME = 'office-pc.tail1234.ts.net';

  /** The hub's tailnet as the preview sees it: it records what it serves and what it takes off again. */
  function tailnet() {
    const served: number[] = [];
    const stopped: number[] = [];
    const t: PreviewTailnet = {
      serve: async (port) => {
        served.push(port);
        return { host: NAME, port, url: `https://${NAME}:${port}/`, stop: async () => void stopped.push(port) };
      },
    };
    return { t, served, stopped };
  }

  /** The preview once it has its tailnet address. */
  async function onTailnet(previews: Previews, id: string): Promise<PreviewView> {
    await within(
      new Promise<void>((resolve) => {
        const look = () => (previews.view(id).tailnetUrl ? resolve() : setTimeout(look, 25));
        look();
      }),
      SETTLE_MS,
      () => 'The preview never got its tailnet address.',
    );
    return previews.view(id);
  }

  it('serves the app at its own https port of the ts.net name too, and goes off it on a stop', async () => {
    const root = project(fakeDev('serve'));
    const tn = tailnet();
    const { previews, settled, changes } = previewsFor({ tailnet: tn.t });
    previews.start('phone', root);
    const port = portOf((await settled('phone')).url);
    expect(await onTailnet(previews, 'phone')).toEqual({
      state: 'up',
      url: `http://127.0.0.1:${port}/`,
      tailnetUrl: expect.stringMatching(new RegExp(`^https://${NAME.replaceAll('.', '\\.')}:${port}/\\?worklings-preview=[A-Za-z0-9_-]{43}$`)),
      command: 'npm run dev',
      problem: null,
    });
    expect(tn.served).toEqual([port]);
    expect(changes.filter((id) => id === 'phone').length).toBeGreaterThanOrEqual(2);
    expect(await previews.stop('phone')).toEqual({ state: 'off', url: null, command: 'npm run dev', problem: null });
    expect(tn.stopped).toEqual([port]);
  }, TEST_MS);

  // On the tailnet anyone Tailscale lets reach the computer reaches the proxy: only the office's link may let them in.
  describe('lets in only a browser that opened it from the office', () => {
    let previews: Previews;
    let url = '';
    let port = 0;
    let key = '';
    let origin = '';
    const SHUT_OUT = "To see this preview, open it from the Worklings office on this device: the office's link is what lets it in.";

    beforeAll(async () => {
      const made = previewsFor({ shared: true, tailnet: tailnet().t });
      previews = made.previews;
      previews.start('phone', project(fakeDev('serve')));
      url = (await made.settled('phone')).url ?? '';
      port = portOf(url);
      const view = await onTailnet(previews, 'phone');
      key = new URL(view.tailnetUrl ?? '').searchParams.get('worklings-preview') ?? '';
      origin = `https://${NAME}:${port}`;
    }, TEST_MS);

    afterAll(async () => {
      await previews.closeAll();
    }, TEST_MS);

    /** What tailscale serve forwards: the phone's own Host, and the headers it adds. */
    const fromPhone = (headers: Record<string, string> = {}) => ({ host: `${NAME}:${port}`, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', ...headers });
    const viaTailnet = (path: string, headers: Record<string, string> = {}) => call(`${url}${path}`, { headers: fromPhone(headers) });
    /** The preview's cookie as the browser sends it back, from the answer that set it. */
    const cookieOf = (answer: Answer) => (answer.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const echoed = (answer: Answer) => JSON.parse(answer.body) as { url: string; headers: Record<string, string> };

    it('turns away a request without the key, or with a wrong one, with a page that says to open it from the office', async () => {
      const wrong = 'A'.repeat(43);
      for (const path of ['echo', `echo?worklings-preview=${wrong}`, 'echo?worklings-preview=', `?worklings-preview=${key.slice(1)}`]) {
        const answer = await viaTailnet(path);
        expect(answer).toMatchObject({ status: 403, body: SHUT_OUT, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        expect(answer.headers).not.toHaveProperty('set-cookie');
      }
    });

    it('trades the key for a cookie of its own, and sends the browser to the same address without it', async () => {
      const traded = await viaTailnet(`menu?a=1&worklings-preview=${key}&b=two%20words`);
      expect(traded).toMatchObject({ status: 303, body: '', headers: { location: `${origin}/menu?a=1&b=two%20words`, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } });
      expect(traded.headers['set-cookie']).toEqual([expect.stringMatching(new RegExp(`^__Host-worklings-preview-${port}=[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Strict$`))]);
      // A path that would read as another site stays a path on the preview's own origin.
      expect((await viaTailnet(`/elsewhere.example/?worklings-preview=${key}`)).headers.location).toBe(`${origin}//elsewhere.example/`);
    });

    it('lets a request with the cookie through to the app, as from this computer', async () => {
      const cookie = cookieOf(await viaTailnet(`?worklings-preview=${key}`));
      const echo = await viaTailnet('echo?step=2', { cookie });
      expect(echo.status).toBe(200);
      expect(echoed(echo)).toMatchObject({ url: '/echo?step=2', headers: { host: `127.0.0.1:${port}` } });
      expect(await viaTailnet('moved', { cookie })).toMatchObject({ status: 302, headers: { location: `${origin}/echo?from=moved` } });
      // A browser that has the cookie and still carries the key goes on without the key, and gets no second cookie.
      const again = await viaTailnet(`echo?worklings-preview=${key}`, { cookie });
      expect(again).toMatchObject({ status: 303, headers: { location: `${origin}/echo` } });
      expect(again.headers).not.toHaveProperty('set-cookie');
      // The tailnet's name at another port, or with no port, is still someone else.
      for (const host of [NAME, `${NAME}:${port + 1}`]) expect((await viaTailnet('echo', { host, cookie })).status).toBe(403);
    });

    it('takes a WebSocket upgrade from the tailnet only with the cookie', async () => {
      const cookie = cookieOf(await viaTailnet(`?worklings-preview=${key}`));
      const { host, ...forwarding } = fromPhone();
      expect(await handshake(`${url}hmr`, host, forwarding)).toBe(403);
      expect(await handshake(`${url}hmr`, host, { ...forwarding, cookie: `__Host-worklings-preview-${port}=${'A'.repeat(43)}` })).toBe(403);
      expect(await handshake(`${url}hmr`, host, { ...forwarding, cookie })).toBe(101);
    });

    it('never passes the cookie or the key on to the app', async () => {
      const cookie = cookieOf(await viaTailnet(`?worklings-preview=${key}`));
      const seen = echoed(await viaTailnet('echo', { cookie: `theme=dark; ${cookie}`, referer: `${origin}/menu?worklings-preview=${key}` }));
      expect(seen.headers).not.toHaveProperty('cookie');
      expect(seen.headers).not.toHaveProperty('referer');
      expect(echoed(await viaTailnet('echo', { cookie, referer: `${origin}/menu` })).headers.referer).toBe(`${origin}/menu`);
      // The fake app takes an upgrade at /hmr and nowhere else, so a 101 shows the key never got there.
      const { host, ...forwarding } = fromPhone();
      expect(await handshake(`${url}hmr?worklings-preview=${key}`, host, { ...forwarding, cookie })).toBe(101);
    });

    it("never tells the app who is asking: Tailscale's identity headers stay at the proxy", async () => {
      const cookie = cookieOf(await viaTailnet(`?worklings-preview=${key}`));
      const identity = {
        'tailscale-user-login': 'robin@example.com',
        'tailscale-user-name': 'Sam Rivera',
        'tailscale-user-profile-pic': 'https://example.com/robin.png',
        'tailscale-app-capabilities': '{"example.com/cap/admin":[{}]}',
        'tailscale-headers-info': 'https://tailscale.com/s/serve-headers',
      };
      const seen = echoed(await viaTailnet('echo', { cookie, ...identity, 'x-app': 'kept' })).headers;
      for (const name of Object.keys(identity)) expect(seen).not.toHaveProperty(name);
      expect(seen).toMatchObject({ 'x-app': 'kept' });
    });

    it('still needs the cookie for a request tailscale serve forwards with this computer as its Host', async () => {
      const cookie = cookieOf(await viaTailnet(`?worklings-preview=${key}`));
      const spoofed = { host: `127.0.0.1:${port}` };
      expect(await viaTailnet('echo', spoofed)).toMatchObject({ status: 403, body: SHUT_OUT });
      expect((await viaTailnet('echo', { ...spoofed, cookie })).status).toBe(200);
    });

    it('answers this computer as before: no key and no cookie', async () => {
      const echo = await call(`${url}echo`);
      expect(echo.status).toBe(200);
      expect(echoed(echo).headers.host).toBe(`127.0.0.1:${port}`);
      expect(await handshake(`${url}hmr`, `127.0.0.1:${port}`)).toBe(101);
    });
  });

  it('keeps the preview on this computer when the tailnet refuses it', async () => {
    const root = project(fakeDev('serve'));
    let refuse = () => {};
    const asked = new Promise<void>((resolve) => (refuse = resolve));
    const refusing: PreviewTailnet = {
      serve: () => {
        refuse();
        return Promise.reject(new Error('Tailscale Funnel shares that port.'));
      },
    };
    const { previews, settled } = previewsFor({ tailnet: refusing });
    previews.start('desk-only', root);
    const up = await settled('desk-only');
    await within(asked, SETTLE_MS, () => 'The preview never asked the tailnet.');
    await new Promise((resolve) => setImmediate(resolve));
    expect(previews.view('desk-only')).toEqual({ state: 'up', url: up.url, command: 'npm run dev', problem: null });
    expect((await call(up.url ?? '')).status).toBe(200);
  }, TEST_MS);
});

describe('a preview that fails', () => {
  it('ends in down with a sentence when the command prints no address in time, and stops it', async () => {
    const root = project(fakeDev('silent'));
    // The test says when the time is up, once the dev server runs, so a slow start can't run out the clock first.
    const clocks: { giveUp: () => void; ms: number }[] = [];
    const { previews, started } = previewsFor({
      deadline: (giveUp, ms) => {
        clocks.push({ giveUp, ms });
        return () => undefined;
      },
    });
    previews.start('quiet', root);
    const fake = await fakeOf(root);
    expect(previews.view('quiet').state).toBe('starting');
    expect(clocks.map((c) => c.ms)).toEqual([60_000]);
    clocks[0]?.giveUp();
    expect(previews.view('quiet')).toEqual({
      state: 'down',
      url: null,
      command: 'npm run dev',
      problem: 'npm run dev printed no local address within 60 seconds, so the office stopped it.',
    });
    const npm = started[0]?.child;
    if (!npm) throw new Error('The preview started no process.');
    await within(Promise.all([exitOf(npm), fake.gone]), GONE_MS, () => 'npm and the dev server it started were still running.');
  }, TEST_MS);

  it('ends in down with the exit code and what it said when the command stops early', async () => {
    const { previews, settled } = previewsFor();
    previews.start('crashy', project(fakeDev('exit')));
    expect(await settled('crashy')).toMatchObject({
      state: 'down',
      problem: 'npm run dev stopped with exit code 3 before the app was up: Error: the fake dev server failed on purpose',
    });
  }, TEST_MS);

  it('says to install the dependencies when they are missing', async () => {
    const { previews, settled } = previewsFor();
    previews.start('fresh', project(fakeDev('exit'), { dependencies: { vite: '^8.3.5' } }));
    expect((await settled('fresh')).problem).toMatch(/: Error: the fake dev server failed on purpose Run npm install in the project first\.$/);
  }, TEST_MS);

  it('ends in down when the dev server only serves https, and stops it', async () => {
    const root = project(fakeDev('https'));
    const { previews, settled } = previewsFor();
    previews.start('secure', root);
    const fake = await fakeOf(root);
    expect(await settled('secure')).toMatchObject({
      state: 'down',
      problem: 'npm run dev serves https://localhost:5999/, but the preview needs plain http, so the office stopped it.',
    });
    await within(fake.gone, GONE_MS, () => 'The https dev server was still running.');
  }, TEST_MS);

  it('ends in down at once, starting nothing, when there is no dev command', () => {
    const { previews, started } = previewsFor();
    expect(previews.start('docs', project({ build: 'tsc' }))).toEqual({
      state: 'down',
      url: null,
      command: null,
      problem: "The project's package.json has no dev or start script, so there's no app to start.",
    });
    expect(previews.start('bare', project(null))).toMatchObject({ state: 'down', problem: "The project has no package.json, so there's no app the office knows how to start." });
    expect(started).toEqual([]);
  });
});

describe('stopping a preview', () => {
  it('leaves nothing running: npm, the dev server, what it started, and the proxy', async () => {
    const root = project(fakeDev('tree'));
    const { previews, started, settled } = previewsFor();
    previews.start('studio', root);
    const up = await settled('studio');
    expect(up.state).toBe('up');
    const [server, child] = await Promise.all([fakeOf(root), fakeOf(root, 'child')]);
    const npm = started[0]?.child;
    if (!npm) throw new Error('The preview started no process.');
    expect([server.ended, child.ended, npm.exitCode]).toEqual([false, false, null]);

    expect(await previews.stop('studio')).toEqual({ state: 'off', url: null, command: 'npm run dev', problem: null });
    // Each process's end as it happens: npm's exit, and the system closing the dev server's and its child's lifelines.
    await within(Promise.all([exitOf(npm), server.gone, child.gone]), GONE_MS, () => 'Something the preview started was still running.');
    expect(await refused(portOf(up.url))).toBe(true);
    expect(previews.view('studio')).toEqual({ state: 'off', url: null, command: 'npm run dev', problem: null });
  }, TEST_MS);

  it('closes every company preview at once', async () => {
    const { previews, settled } = previewsFor();
    const roots = [project(fakeDev('serve')), project(fakeDev('serve'))];
    roots.forEach((root, i) => previews.start(`company-${i}`, root));
    const views = await Promise.all(roots.map((_, i) => settled(`company-${i}`)));
    expect(views.map((v) => v.state)).toEqual(['up', 'up']);
    const servers = await Promise.all(roots.map((root) => fakeOf(root)));
    await previews.closeAll();
    expect(roots.map((_, i) => previews.view(`company-${i}`).state)).toEqual(['off', 'off']);
    await within(Promise.all(servers.map((s) => s.gone)), GONE_MS, () => 'A dev server was still running after closeAll.');
    for (const view of views) expect(await refused(portOf(view.url))).toBe(true);
  }, TEST_MS);

  it('starts again after a stop, behind a new proxy', async () => {
    const root = project(fakeDev('serve'));
    const { previews, started, settled } = previewsFor();
    previews.start('again', root);
    const first = await settled('again');
    await previews.stop('again');
    expect(previews.start('again', root).state).toBe('starting');
    const second = await settled('again');
    expect(second.state).toBe('up');
    expect(second.url).not.toBe(first.url);
    expect(started).toHaveLength(2);
    expect((await call(second.url ?? '')).body).toContain('Hello from the fake app');
  }, TEST_MS);
});
