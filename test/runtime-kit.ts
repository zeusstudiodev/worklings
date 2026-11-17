// What the switchboard's tests share: a fake hub on 127.0.0.1 (desk tokens, the PermissionRequest and liveness hooks,
// a small org-tools server), a recorder for DeskEvents that tests wait on, a test gate, and a world that wires a
// switchboard to test/fake-desk.mjs in temporary folders. Nothing here reaches the real Claude Code.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeskControl, DeskEvents, DeskPlan, DeskView, TurnResult } from '../src/core/company.ts';
import { createSwitchboard, type DeskGate, type SwitchboardTiming } from '../src/runtime/index.ts';
import { tempDir } from './library-kit.ts';

export const FAKE_DESK = fileURLToPath(new URL('./fake-desk.mjs', import.meta.url));

// ---------------------------------------------------------------------------------------------------------------------
// The fake hub

export interface HubCall {
  path: string;
  /** Whether the request carried a desk token the hub had issued and not revoked. */
  tokenOk: boolean;
  token: string | null;
  body: unknown;
  method: string | null;
}

export interface FakeHub {
  url: string;
  issue(person: string, cwd?: string, scratch?: string): string;
  revoke(token: string): void;
  /** Every token issued, with whom it was for, the desk's scratch folder and whether it is revoked. */
  tokens: Map<string, { person: string; cwd: string | null; scratch: string | null; revoked: boolean }>;
  calls: HubCall[];
  /** How the hub answers a PermissionRequest; allow by default. */
  decide: (payload: Record<string, unknown>) => { behavior: 'allow' } | { behavior: 'deny'; message: string };
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((done) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
  });

export async function fakeHub(): Promise<FakeHub> {
  const tokens = new Map<string, { person: string; cwd: string | null; scratch: string | null; revoked: boolean }>();
  const calls: HubCall[] = [];
  const valid = (token: string | null) => token !== null && tokens.has(token) && tokens.get(token)?.revoked === false;
  const hub: FakeHub = {
    url: '',
    tokens,
    calls,
    decide: () => ({ behavior: 'allow' }),
    issue(person, cwd, scratch) {
      const token = randomBytes(32).toString('hex');
      tokens.set(token, { person, cwd: cwd ?? null, scratch: scratch ?? null, revoked: false });
      return token;
    },
    revoke(token) {
      const t = tokens.get(token);
      if (t) t.revoked = true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    void (async () => {
      const text = await readBody(req);
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      const path = req.url ?? '';
      const auth = req.headers.authorization;
      const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const header = typeof req.headers['x-worklings-desk'] === 'string' ? req.headers['x-worklings-desk'] : null;
      const token = path === '/mcp' ? bearer : header;
      const rpc = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      calls.push({ path, tokenOk: valid(token), token, body, method: typeof rpc.method === 'string' ? rpc.method : null });
      if (path === '/desk/permission') {
        if (!valid(token)) return json(res, 403, { error: 'desk-token' });
        const decision = hub.decide(rpc);
        return json(res, 200, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
      }
      if (path === '/desk/hook') {
        res.writeHead(valid(token) ? 200 : 403, { 'content-length': '0' });
        return res.end();
      }
      if (path === '/mcp') {
        if (!valid(token)) return json(res, 401, { jsonrpc: '2.0', error: { code: -31001, message: 'bad token' } }, { 'www-authenticate': 'Bearer realm="worklings-org"' });
        const id = rpc.id ?? null;
        const person = token ? (tokens.get(token)?.person ?? '?') : '?';
        if (rpc.method === 'server/discover') return json(res, 200, { jsonrpc: '2.0', id, result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } });
        if (rpc.method === 'tools/list') {
          return json(res, 200, { jsonrpc: '2.0', id, result: { tools: ['post_status', 'report'].map((name) => ({ name, inputSchema: { type: 'object' } })) } });
        }
        if (rpc.method === 'tools/call') {
          const params = (rpc.params ?? {}) as Record<string, unknown>;
          return json(res, 200, { jsonrpc: '2.0', id, result: { resultType: 'complete', content: [{ type: 'text', text: `${String(params.name)} done for ${person}` }], isError: false } });
        }
        return json(res, 400, { jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method' } });
      }
      res.writeHead(404).end();
    })();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  hub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return hub;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the switchboard tells the company

export type Heard =
  | { kind: 'desk'; view: DeskView; at: number }
  | { kind: 'delivered'; messageId: string; at: number; how: 'next-step' | 'new-turn' | undefined }
  | { kind: 'session'; person: string; sessionId: string; at: number }
  | { kind: 'turn'; person: string; result: TurnResult; at: number }
  | { kind: 'own-turn'; person: string; at: number }
  | { kind: 'limited'; until: number | null; message: string; reason: string; at: number }
  | { kind: 'notice'; sentence: string; at: number };

export interface Recorder {
  events: DeskEvents;
  heard: Heard[];
  /** The first event from index `from` on that `test` picks; waits for it when it hasn't come yet. */
  waitFor<T extends Heard>(test: (e: Heard) => e is T, o?: { from?: number; ms?: number; what?: string }): Promise<T>;
  /** Called on every event after it is recorded, so a test can act like the company does. */
  onHeard?: (e: Heard) => void;
}

export function recorder(): Recorder {
  const heard: Heard[] = [];
  const waiters = new Set<(e: Heard) => void>();
  const rec: Recorder = {
    heard,
    events: {
      desk: (view) => push({ kind: 'desk', view: { ...view }, at: Date.now() }),
      delivered: (messageId, at, how) => push({ kind: 'delivered', messageId, at, how }),
      session: (person, sessionId) => push({ kind: 'session', person, sessionId, at: Date.now() }),
      turn: (person, result) => push({ kind: 'turn', person, result, at: Date.now() }),
      ownTurn: (person) => push({ kind: 'own-turn', person, at: Date.now() }),
      limited: (until, message, reason) => push({ kind: 'limited', until, message, reason, at: Date.now() }),
      notice: (sentence) => push({ kind: 'notice', sentence, at: Date.now() }),
    },
    waitFor(test, o = {}) {
      const found = heard.slice(o.from ?? 0).find(test);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(listener);
          reject(new Error(`No ${o.what ?? 'matching event'} within ${o.ms ?? 30_000} ms. Heard: ${heard.map(describe).join('; ')}`));
        }, o.ms ?? 30_000);
        const listener = (e: Heard) => {
          if (!test(e)) return;
          clearTimeout(timer);
          waiters.delete(listener);
          resolve(e);
        };
        waiters.add(listener);
      });
    },
  };
  function push(e: Heard) {
    heard.push(e);
    rec.onHeard?.(e);
    for (const w of [...waiters]) w(e);
  }
  return rec;
}

function describe(e: Heard): string {
  if (e.kind === 'desk') return `desk ${e.view.person} ${e.view.state}${e.view.queue ? ` #${e.view.queue}` : ''}${e.view.problem ? ` (${e.view.problem})` : ''}`;
  if (e.kind === 'delivered') return `delivered ${e.messageId}`;
  if (e.kind === 'session') return `session ${e.person}`;
  if (e.kind === 'turn') return `turn ${e.person} ${e.result.ok ? 'ok' : `failed: ${e.result.problem}`}`;
  if (e.kind === 'notice') return `notice ${e.sentence}`;
  if (e.kind === 'own-turn') return `own turn ${e.person}`;
  return `limited ${e.reason}`;
}

export const isDesk = (person: string, state?: DeskView['state']) => (e: Heard): e is Extract<Heard, { kind: 'desk' }> =>
  e.kind === 'desk' && e.view.person === person && (state === undefined || e.view.state === state);
export const isDelivered = (messageId: string) => (e: Heard): e is Extract<Heard, { kind: 'delivered' }> => e.kind === 'delivered' && e.messageId === messageId;
export const isTurn = (person: string) => (e: Heard): e is Extract<Heard, { kind: 'turn' }> => e.kind === 'turn' && e.person === person;
export const isSession = (person: string) => (e: Heard): e is Extract<Heard, { kind: 'session' }> => e.kind === 'session' && e.person === person;
export const isLimited = (e: Heard): e is Extract<Heard, { kind: 'limited' }> => e.kind === 'limited';

// ---------------------------------------------------------------------------------------------------------------------
// A gate shared across switchboards, as the hub's

export function testGate(max: number): DeskGate & { inUse: () => number } {
  let used = 0;
  const listeners = new Set<() => void>();
  return {
    take: () => {
      if (used >= max) return false;
      used++;
      return true;
    },
    give: () => {
      used = Math.max(0, used - 1);
      queueMicrotask(() => {
        for (const l of [...listeners]) l();
      });
    },
    onFree: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    inUse: () => used,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// A switchboard on the fake desk

export interface FakeLogEntry {
  pid: number;
  at: number;
  event: string;
  argv?: string[];
  cwd?: string;
  settings?: string | null;
  mcpConfig?: string | null;
  env?: { emitSessionState: string | null; disablePromptCaching: string | null; claudecode: boolean; hasToken: boolean; tokenLength: number };
  /** The temporary folder the desk was given. */
  tmp?: { TMP: string | null; TEMP: string | null; TMPDIR: string | null };
  line?: Record<string, unknown>;
  childPid?: number;
  code?: number;
  [key: string]: unknown;
}

export interface World {
  dir: string;
  project: string;
  scratch: string;
  /** The folder standing for the user's ~/.claude: empty until a test writes a settings.json or plugins into it. */
  configDir: string;
  hub: FakeHub;
  rec: Recorder;
  board: DeskControl;
  log(): FakeLogEntry[];
  starts(): FakeLogEntry[];
  /** A plan for a person in this world's project. */
  plan(person: string, extra?: Partial<DeskPlan>): DeskPlan;
  /** Another switchboard on the same hub, fake and folders (a second company), with its own recorder. */
  another(companyId: string, o?: { maxDesks?: number; maxOpen?: number; gate?: DeskGate }): { board: DeskControl; rec: Recorder };
  /** Closes every switchboard and the hub, then waits until no process the fake started is left. */
  close(): Promise<void>;
}

export interface WorldOptions {
  /** People working at once. */
  maxDesks?: number;
  /** Desks open at once, idle ones included; the switchboard's default when not given. */
  maxOpen?: number;
  idleMs?: number;
  gate?: DeskGate;
  timing?: Partial<SwitchboardTiming>;
  rules?: readonly string[];
  /** Act as the company does on a limit: pause the switchboard until the reset. */
  companyPauses?: boolean;
  /** The switchboard's clock (when a desk went idle, say), for tests that move time; real timers still run. */
  now?: () => number;
}

/**
 * What one fake desk process may take on a busy machine, from spawn to its first turn: node starting, then its MCP
 * handshake with the hub, which runs in the test's own worker (two round-trips before init). With a dozen agents running
 * at once that has taken many seconds, so a test that waits on several desk starts (or a start and a taskkill) gets this
 * much time for each, through forStarts. A process start is genuinely what such a wait is for.
 */
export const START_MS = 30_000;
/** The time for `n` desk starts (a taskkill of a desk counts as one). */
export const forStarts = (n: number): number => n * START_MS;

/** Test timing: generous, so a loaded machine doesn't trip a hang or a close that a test didn't ask for. */
const TEST_TIMING: Partial<SwitchboardTiming> = { hangMs: 120_000, startMs: 120_000, interruptMs: 10_000, reopenWaitMs: 10_000, closeWaitMs: 30_000 };

/** The test's own environment with no way to the real Claude Code: the fake is the only Claude Code it can find. */
function fakeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN'].includes(name.toUpperCase()));
  return { ...Object.fromEntries(kept), ...extra };
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Waits until `test` holds, checking every 50 ms, up to `ms`. */
export async function until(test: () => boolean, ms = 10_000, what = 'the condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** Every file under `dir`, recursively. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

export async function world(script: object, o: WorldOptions = {}): Promise<World> {
  const dir = tempDir('worklings-runtime-');
  const project = join(dir, 'project');
  const scratch = join(dir, 'scratch');
  mkdirSync(project);
  mkdirSync(scratch);
  const logFile = join(dir, 'desk.jsonl');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(script));
  // The user's Claude Code files are the test's own, and empty: a lean desk reads the user's deny rules and hooks from them.
  const configDir = join(dir, 'claude-config');
  mkdirSync(configDir);
  const env = fakeEnv({ WORKLINGS_CLAUDE: FAKE_DESK, FAKE_DESK_SCRIPT: scriptFile, FAKE_DESK_LOG: logFile, FAKE_DESK_SESSIONS: join(dir, 'sessions'), CLAUDE_CONFIG_DIR: configDir });
  const hub = await fakeHub();
  const rec = recorder();
  const boards: DeskControl[] = [];
  const make = (companyId: string, events: DeskEvents, maxDesks: number, gate: DeskGate | undefined, maxOpen: number | undefined = o.maxOpen) => {
    const board = createSwitchboard({
      companyId,
      root: project,
      hub,
      events,
      maxDesks,
      ...(maxOpen !== undefined ? { maxOpen } : {}),
      idleMs: o.idleMs ?? 60_000,
      env,
      claude: FAKE_DESK,
      scratch,
      timing: { ...TEST_TIMING, ...o.timing },
      ...(gate ? { gate } : {}),
      ...(o.rules ? { rules: () => o.rules ?? [] } : {}),
      ...(o.now ? { now: o.now } : {}),
    });
    boards.push(board);
    return board;
  };
  const board = make('acme', rec.events, o.maxDesks ?? 4, o.gate);
  if (o.companyPauses) {
    rec.onHeard = (e) => {
      if (e.kind === 'limited') board.pause(e.until);
    };
  }
  const log = (): FakeLogEntry[] => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry) : []);
  return {
    dir,
    project,
    scratch,
    configDir,
    hub,
    rec,
    board,
    log,
    starts: () => log().filter((e) => e.event === 'start'),
    plan: (person, extra = {}) => ({
      person: { id: person, name: person.charAt(0).toUpperCase() + person.slice(1), title: 'Frontend engineer', level: 'worker', room: 'engineering', reportsTo: 'ceo', look: {} },
      agent: null,
      model: 'haiku',
      cwd: project,
      sessionId: null,
      systemPrompt: '# Working at Acme\n\n## House rules\n\n- Be kind.',
      ...extra,
    }),
    another: (companyId, a = {}) => {
      const own = recorder();
      return { board: make(companyId, own.events, a.maxDesks ?? 4, a.gate, a.maxOpen), rec: own };
    },
    close: async () => {
      await Promise.all(boards.map((b) => b.closeAll()));
      await hub.close();
      const pids = log().flatMap((e) => [...(e.event === 'start' ? [e.pid] : []), ...(typeof e.childPid === 'number' ? [e.childPid] : [])]);
      await until(() => pids.every((pid) => !alive(pid)), 10_000, `the processes the fake started (${pids.join(', ')}) to be gone`);
    },
  };
}
export const isNotice = (e: Heard): e is Extract<Heard, { kind: 'notice' }> => e.kind === 'notice';
