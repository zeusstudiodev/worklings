import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { findTailscale, startTailnet, TailnetError } from '../src/server/tailnet.ts';
import { tempDir, writeTree } from './library-kit.ts';

const FAKE = fileURLToPath(new URL('./fake-tailscale.mjs', import.meta.url));
const HOST = 'office-pc.tail1234.ts.net';
const PORT = 7421;

// The commands as https://tailscale.com/kb/1242/tailscale-serve documents them (1.52 and later).
const STATUS = ['status', '--json', '--peers=false'];
const SERVE_STATUS = ['serve', 'status', '--json'];
const SERVE_ON = ['serve', '--bg', '--yes', '--https=443', '--set-path=/', `http://127.0.0.1:${PORT}`];
const SERVE_OFF = ['serve', '--https=443', '--set-path=/', '--yes', 'off'];

const NOT_INSTALLED = "Tailscale isn't installed: install it from tailscale.com and sign in, then try again.";
const NO_MAGICDNS =
  'MagicDNS is off for your tailnet: turn on MagicDNS and HTTPS certificates in the DNS page of the Tailscale admin console, then try again.';
const BAD_OUTPUT = "Tailscale answered in a form Worklings doesn't understand: update Tailscale, and check that WORKLINGS_TAILSCALE or the PATH leads to it.";
const ENABLE_LINK = 'https://login.tailscale.com/f/serve?node=nFAKE0000CNTRL';

/** `tailscale status --json --peers=false` on a signed-in Windows computer, as ipnstate.Status is shaped in 1.104.5. */
function status(overrides: Record<string, unknown> = {}, self: Record<string, unknown> = {}): Record<string, unknown> {
  const ips = ['100.101.102.103', 'fd7a:115c:a1e0::1234:5678'];
  return {
    Version: '1.104.5-t0123456789-gabcdef0123',
    TUN: true,
    BackendState: 'Running',
    HaveNodeKey: true,
    AuthURL: '',
    TailscaleIPs: ips,
    Self: {
      ID: 'nFAKE0000CNTRL',
      PublicKey: 'nodekey:0000000000000000000000000000000000000000000000000000000000000000',
      HostName: 'office-pc',
      DNSName: `${HOST}.`,
      OS: 'windows',
      UserID: 1234,
      TailscaleIPs: ips,
      Online: true,
      ...self,
    },
    Health: [],
    MagicDNSSuffix: 'tail1234.ts.net',
    CurrentTailnet: { Name: 'robin@example.com', StableID: 'TFAKE0000CNTRL', MagicDNSSuffix: 'tail1234.ts.net', MagicDNSEnabled: true },
    CertDomains: [HOST],
    Peer: null,
    User: null,
    ClientVersion: null,
    ...overrides,
  };
}

const ROOT = { Proxy: `http://127.0.0.1:${PORT}` };
/** What `tailscale serve --bg --https=443 http://127.0.0.1:7421` leaves in the serve config. */
const OURS = { TCP: { '443': { HTTPS: true } }, Web: { [`${HOST}:443`]: { Handlers: { '/': ROOT } } } };
const at443 = (handlers: Record<string, unknown>) => ({ TCP: OURS.TCP, Web: { [`${HOST}:443`]: { Handlers: handlers } } });

interface FakeState {
  status: unknown;
  serve?: unknown;
  fail?: Record<string, string>;
}

interface Fake {
  dir: string;
  env: NodeJS.ProcessEnv;
  /** The argument lists of every run, in order. */
  calls(): string[][];
  /** The serve config as the fake keeps it. */
  serve(): unknown;
  update(change: (state: FakeState) => void): void;
  /** This test's ledger of preview ports, never the one in ~/.worklings. */
  ledger: string;
  /** The ports the ledger lists, or null when there is no ledger. */
  noted(): number[] | null;
  /** What startTailnet said about an earlier run's leftovers. */
  said: string[];
}

const fakes: Fake[] = [];

function fakeTailscale(setup: Partial<FakeState> = {}, noted: number[] | null = null): Fake {
  const dir = tempDir('worklings-tailnet-');
  const file = join(dir, 'state.json');
  const log = join(dir, 'calls.jsonl');
  const ledger = join(dir, 'ledger', 'tailnet.json');
  const read = () => JSON.parse(readFileSync(file, 'utf8')) as FakeState;
  writeFileSync(file, JSON.stringify({ status: status(), ...setup }));
  if (noted) writeTree(dir, { 'ledger/tailnet.json': { version: 1, previews: noted } });
  const fake: Fake = {
    dir,
    env: { ...process.env, FAKE_TAILSCALE_DIR: dir },
    calls: () =>
      existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { argv: string[] }).argv) : [],
    serve: () => read().serve,
    update(change) {
      const state = read();
      change(state);
      writeFileSync(file, JSON.stringify(state));
    },
    ledger,
    noted: () => (existsSync(ledger) ? (JSON.parse(readFileSync(ledger, 'utf8')) as { previews: number[] }).previews : null),
    said: [],
  };
  fakes.push(fake);
  return fake;
}

/**
 * Every Tailscale command a test makes is a Node start, usually 0.1 to 2 s, but with the other streams' builds running
 * five at once took 2.5 s each and up to 8 s, and a single start up to about 20 s. So the startTailnet tests run in lanes
 * side by side and in turn within each lane: options from `inTurn` take a test out of its lane's concurrency and give it
 * a time limit sized from how many starts it makes (the calls it asserts) plus any wait it provokes, over the project's
 * 30 s default. A command's own limit sits above that (COMMAND_MS), so a slow start only ever meets the test's limit,
 * and a loaded machine slows the file down instead of failing it.
 */
const FLOOR_MS = 30_000;
const PER_START_MS = 10_000;
const COMMAND_MS = 60_000;
const inTurn = (starts: number, waitMs = 0) => ({ concurrent: false, timeout: FLOOR_MS + waitMs + starts * PER_START_MS });

const start = (fake: Fake, more: { timeoutMs?: number; ledger?: string } = {}) =>
  startTailnet({ port: PORT, tailscale: FAKE, env: fake.env, timeoutMs: COMMAND_MS, ledger: fake.ledger, say: (line) => void fake.said.push(line), ...more });

async function failureOf(promise: Promise<unknown>): Promise<TailnetError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TailnetError) return error;
    throw error;
  }
  throw new Error('Expected a TailnetError, but it succeeded.');
}

const said = (error: TailnetError) => ({ code: error.code, message: error.message });

afterAll(() => {
  // Whatever a test set up, Worklings never ran `tailscale funnel` or anything that mentions it.
  const calls = fakes.flatMap((fake) => fake.calls());
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((argv) => argv.some((arg) => /funnel/i.test(arg)))).toEqual([]);
});

describe('findTailscale', () => {
  const files = (...paths: string[]) => (file: string) => paths.includes(file);

  test('takes the option, then WORKLINGS_TAILSCALE, then the PATH, then where the Windows installer puts it', () => {
    const option = 'D:\\tools\\tailscale.exe';
    const variable = 'E:\\portable\\tailscale.exe';
    const onPath = 'C:\\bin\\tailscale.exe';
    const installed = 'C:\\Program Files\\Tailscale\\tailscale.exe';
    const all = files(option, variable, onPath, installed);
    const env = { WORKLINGS_TAILSCALE: variable, Path: 'C:\\Windows;C:\\bin' };
    const found = (path: string) => ({ found: true, command: path, prefixArgs: [], path });

    expect(findTailscale(option, env, 'win32', all)).toEqual(found(option));
    expect(findTailscale(undefined, env, 'win32', all)).toEqual(found(variable));
    expect(findTailscale(undefined, { Path: env.Path }, 'win32', all)).toEqual(found(onPath));
    expect(findTailscale(undefined, { Path: 'C:\\Windows' }, 'win32', all)).toEqual(found(installed));
    expect(findTailscale(undefined, { Path: 'C:\\Windows' }, 'win32', files())).toEqual({ found: false, reason: NOT_INSTALLED });
  });

  test('looks in ProgramFiles when Windows lives on another drive', () => {
    const installed = 'D:\\Programs\\Tailscale\\tailscale.exe';
    expect(findTailscale(undefined, { PROGRAMFILES: 'D:\\Programs' }, 'win32', files(installed))).toMatchObject({ found: true, path: installed });
  });

  test('skips empty and relative PATH folders, so a project folder cannot supply a tailscale', () => {
    const planted = files('tailscale.exe', 'bin\\tailscale.exe', '.\\tailscale.exe');
    expect(findTailscale(undefined, { PATH: '.;bin;;"";C:\\Windows' }, 'win32', planted)).toEqual({ found: false, reason: NOT_INSTALLED });
  });

  test('says what is wrong with a configured path, instead of falling back past it', () => {
    const exe = 'C:\\bin\\tailscale.exe';
    expect(findTailscale(undefined, { WORKLINGS_TAILSCALE: 'tailscale.exe', PATH: 'C:\\bin' }, 'win32', files(exe))).toEqual({
      found: false,
      reason: 'WORKLINGS_TAILSCALE must be the full path to tailscale.exe, but it is tailscale.exe.',
    });
    expect(findTailscale(undefined, { WORKLINGS_TAILSCALE: 'C:\\nowhere\\tailscale.exe', PATH: 'C:\\bin' }, 'win32', files(exe))).toEqual({
      found: false,
      reason: 'WORKLINGS_TAILSCALE is set to C:\\nowhere\\tailscale.exe, but there is no file there: set it to the full path of tailscale.exe, then try again.',
    });
    expect(findTailscale('C:\\tools\\tailscale.cmd', { PATH: 'C:\\bin' }, 'win32', files(exe, 'C:\\tools\\tailscale.cmd'))).toEqual({
      found: false,
      reason: 'The Tailscale path points to tailscale.cmd, which only a shell can run: set it to the full path of tailscale.exe, then try again.',
    });
  });

  test('runs a JavaScript stand-in with this Node', () => {
    const script = 'C:\\tests\\fake-tailscale.mjs';
    expect(findTailscale(script, {}, 'win32', files(script))).toEqual({ found: true, command: process.execPath, prefixArgs: [script], path: script });
  });

  test('looks only on the PATH outside Windows', () => {
    expect(findTailscale(undefined, { PATH: '/usr/local/bin:/usr/bin' }, 'linux', files('/usr/bin/tailscale'))).toMatchObject({ found: true, path: '/usr/bin/tailscale' });
    expect(findTailscale(undefined, { PATH: '' }, 'linux', files('C:\\Program Files\\Tailscale\\tailscale.exe'))).toEqual({ found: false, reason: NOT_INSTALLED });
  });
});

// Lanes side by side, each test in turn within its lane (see `inTurn`), each stating how many Node starts it makes.
describe.concurrent('startTailnet', () => {
  describe('serves and stops', () => {
    test('serves the office at the MagicDNS name, and stop takes it off again', inTurn(6), async ({ expect }) => {
      const fake = fakeTailscale();
      const tailnet = await start(fake);

      expect({ host: tailnet.host, url: tailnet.url }).toEqual({ host: HOST, url: `https://${HOST}/` });
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, SERVE_ON, SERVE_STATUS]);
      expect(fake.serve()).toEqual(OURS);

      await tailnet.stop();
      expect(fake.calls().slice(4)).toEqual([SERVE_STATUS, SERVE_OFF]);
      expect(fake.serve()).toEqual({});

      await tailnet.stop();
      expect(fake.calls()).toHaveLength(6);
    });

    test('runs the Tailscale that WORKLINGS_TAILSCALE names when no path is given', inTurn(2), async ({ expect }) => {
      const fake = fakeTailscale({ serve: OURS });
      const tailnet = await startTailnet({ port: PORT, env: { ...fake.env, WORKLINGS_TAILSCALE: FAKE }, timeoutMs: COMMAND_MS, ledger: fake.ledger });
      expect(tailnet.host).toBe(HOST);
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
    });

    // These start from the entry an earlier run left behind: taking it over costs two commands where serving costs four.
    describe('stop', () => {
      test('takes over the entry an earlier run left behind, and removes it on stop', inTurn(4), async ({ expect }) => {
        const fake = fakeTailscale({ serve: OURS });
        const tailnet = await start(fake);
        expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);

        await tailnet.stop();
        expect(fake.calls().slice(2)).toEqual([SERVE_STATUS, SERVE_OFF]);
        expect(fake.serve()).toEqual({});
      });

      test('leaves every other entry alone', inTurn(4), async ({ expect }) => {
        const others = {
          TCP: { '22': { TCPForward: '127.0.0.1:22' }, '8443': { HTTPS: true } },
          Web: { [`${HOST}:8443`]: { Handlers: { '/grafana/': { Proxy: 'http://127.0.0.1:3000' } } } },
          AllowFunnel: { [`${HOST}:8443`]: true },
        };
        const fake = fakeTailscale({ serve: { TCP: { ...others.TCP, ...OURS.TCP }, Web: { ...others.Web, ...OURS.Web }, AllowFunnel: others.AllowFunnel } });
        const tailnet = await start(fake);
        await tailnet.stop();
        expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, SERVE_STATUS, SERVE_OFF]);
        expect(fake.serve()).toEqual(others);
      });

      test('leaves the address alone when someone pointed it elsewhere meanwhile', inTurn(3), async ({ expect }) => {
        const fake = fakeTailscale({ serve: OURS });
        const tailnet = await start(fake);
        const theirs = at443({ '/': { Proxy: 'http://127.0.0.1:3000' } });
        fake.update((state) => {
          state.serve = theirs;
        });

        await tailnet.stop();
        expect(fake.calls().slice(2)).toEqual([SERVE_STATUS]);
        expect(fake.serve()).toEqual(theirs);
      });

      test('counts it done when the entry went some other way as it removed it', inTurn(5), async ({ expect }) => {
        const fake = fakeTailscale({ serve: OURS, fail: { serveOff: 'gone' } });
        const tailnet = await start(fake);
        await tailnet.stop();
        expect(fake.calls().slice(2)).toEqual([SERVE_STATUS, SERVE_OFF, SERVE_STATUS]);
        expect(fake.serve()).toEqual({});
      });

      test('says what to do when it cannot take the office off, and tries again on the next call', inTurn(7), async ({ expect }) => {
        const fake = fakeTailscale({ serve: OURS, fail: { serveOff: 'error' } });
        const tailnet = await start(fake);
        expect(said(await failureOf(tailnet.stop()))).toEqual({
          code: 'failed',
          message: `Worklings couldn't take https://${HOST} off your tailnet (error: something broke): run tailscale serve --https=443 off to do it yourself.`,
        });
        expect(fake.calls().slice(2)).toEqual([SERVE_STATUS, SERVE_OFF, SERVE_STATUS]);
        expect(fake.serve()).toEqual(OURS);

        fake.update((state) => {
          delete state.fail;
        });
        await tailnet.stop();
        expect(fake.calls().slice(5)).toEqual([SERVE_STATUS, SERVE_OFF]);
        expect(fake.serve()).toEqual({});
      });

      test('says so when Tailscale stopped running before stop', inTurn(3), async ({ expect }) => {
        const fake = fakeTailscale({ serve: OURS });
        const tailnet = await start(fake);
        fake.update((state) => {
          state.fail = { serveStatus: 'not-running' };
        });
        expect(said(await failureOf(tailnet.stop()))).toEqual({
          code: 'not-running',
          message: `Tailscale isn't running, so Worklings couldn't take https://${HOST} off your tailnet: once it runs again, run tailscale serve --https=443 off.`,
        });
        expect(fake.calls()).toHaveLength(3);
      });
    });
  });

  // A preview, for a phone: the proxy's port number as its own https port of the name, next to the office's 443.
  describe('serves a preview at a port of its own', () => {
    const PREVIEW = 52_345;
    const PREVIEW_ON = ['serve', '--bg', '--yes', `--https=${PREVIEW}`, '--set-path=/', `http://127.0.0.1:${PREVIEW}`];
    const PREVIEW_OFF = ['serve', `--https=${PREVIEW}`, '--set-path=/', '--yes', 'off'];
    const atPreview = (handlers: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      TCP: { ...OURS.TCP, [String(PREVIEW)]: { HTTPS: true } },
      Web: { ...OURS.Web, [`${HOST}:${PREVIEW}`]: { Handlers: handlers } },
      ...extra,
    });

    test('next to the office, and its stop takes only the preview off', inTurn(7), async ({ expect }) => {
      const fake = fakeTailscale({ serve: OURS });
      const tailnet = await start(fake);
      const entry = await tailnet.serve(PREVIEW);
      expect({ host: entry.host, port: entry.port, url: entry.url }).toEqual({ host: HOST, port: PREVIEW, url: `https://${HOST}:${PREVIEW}/` });
      expect(fake.calls().slice(2)).toEqual([SERVE_STATUS, PREVIEW_ON, SERVE_STATUS]);
      expect(fake.serve()).toEqual(atPreview({ '/': { Proxy: `http://127.0.0.1:${PREVIEW}` } }));

      await entry.stop();
      expect(fake.calls().slice(5)).toEqual([SERVE_STATUS, PREVIEW_OFF]);
      expect(fake.serve()).toEqual(OURS);
      await entry.stop();
      expect(fake.calls()).toHaveLength(7);
    });

    test('refuses a port that already leads elsewhere, or that Funnel shares, and changes nothing', inTurn(4), async ({ expect }) => {
      const theirs = atPreview({ '/': { Proxy: 'http://127.0.0.1:3000' } });
      const fake = fakeTailscale({ serve: theirs });
      const tailnet = await start(fake);
      expect(said(await failureOf(tailnet.serve(PREVIEW)))).toEqual({
        code: 'in-use',
        message: `https://${HOST}:${PREVIEW} already serves http://127.0.0.1:3000 on your tailnet, and Worklings won't replace it: remove it with tailscale serve --https=${PREVIEW} off, then try again.`,
      });
      const funnelled = atPreview({ '/': { Proxy: `http://127.0.0.1:${PREVIEW}` } }, { AllowFunnel: { [`${HOST}:${PREVIEW}`]: true } });
      fake.update((state) => {
        state.serve = funnelled;
      });
      expect(said(await failureOf(tailnet.serve(PREVIEW)))).toEqual({
        code: 'funnel',
        message: `Tailscale Funnel shares https://${HOST}:${PREVIEW} on the public internet, and Worklings never serves there: turn it off with tailscale funnel --https=${PREVIEW} off, then try again.`,
      });
      expect(fake.calls().slice(2)).toEqual([SERVE_STATUS, SERVE_STATUS]);
      expect(fake.serve()).toEqual(funnelled);
    });

    test('writes the preview down in the ledger while it is served, and crosses it off once it is off', inTurn(7), async ({ expect }) => {
      const fake = fakeTailscale({ serve: OURS });
      const tailnet = await start(fake);
      expect(fake.noted()).toBeNull();
      const entry = await tailnet.serve(PREVIEW);
      expect(fake.noted()).toEqual([PREVIEW]);
      await entry.stop();
      expect(fake.noted()).toEqual([]);
      expect(fake.serve()).toEqual(OURS);
    });

    test('keeps a preview off the tailnet when it cannot write it down, so a crash never strands it', inTurn(3), async ({ expect }) => {
      const fake = fakeTailscale({ serve: OURS });
      // A folder where the ledger should be: nothing can be written there.
      mkdirSync(fake.ledger, { recursive: true });
      const tailnet = await start(fake);
      const error = await failureOf(tailnet.serve(PREVIEW));
      expect(error.code).toBe('failed');
      expect(error.message).toMatch(
        new RegExp(`^Worklings couldn't write https://${HOST.replaceAll('.', '\\.')}:${PREVIEW} down in .+ \\(E[A-Z]+\\), so it kept the preview off your tailnet: after a crash nothing would take it off\\.$`),
      );
      expect(fake.calls().slice(2)).toEqual([SERVE_STATUS]);
      expect(fake.serve()).toEqual(OURS);
    });

    test("never serves a preview at the office's own port, nor at one that isn't a port", inTurn(2), async ({ expect }) => {
      const fake = fakeTailscale({ serve: OURS });
      const tailnet = await start(fake);
      await expect(tailnet.serve(443)).rejects.toThrow("serve: port 443 is the office's own.");
      await expect(tailnet.serve(0)).rejects.toThrow('serve: port must be a whole number from 1 to 65535, got 0.');
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
    });
  });

  // A hub that crashed left its previews' --bg entries behind, and its ledger lists their ports.
  describe('cleans up after a run that crashed', () => {
    const [LEFT, MOVED, GONE, OTHER] = [52_345, 52_346, 52_347, 52_348];
    const offAt = (port: number) => ['serve', `--https=${port}`, '--set-path=/', '--yes', 'off'];
    const previewAt = (port: number, proxy = `http://127.0.0.1:${port}`) => ({ [`${HOST}:${port}`]: { Handlers: { '/': { Proxy: proxy } } } });
    const tcp = (...ports: number[]) => Object.fromEntries(ports.map((p) => [String(p), { HTTPS: true }]));

    test('takes off the preview entries its ledger lists that still lead to their port, and nothing else', inTurn(4), async ({ expect }) => {
      // LEFT is the crashed run's; MOVED leads elsewhere now; GONE was taken off by hand; OTHER looks the same as LEFT but isn't in the ledger.
      const theirs = {
        TCP: { ...OURS.TCP, ...tcp(MOVED, OTHER) },
        Web: { ...OURS.Web, ...previewAt(MOVED, 'http://127.0.0.1:3000'), ...previewAt(OTHER) },
      };
      const fake = fakeTailscale({ serve: { TCP: { ...theirs.TCP, ...tcp(LEFT) }, Web: { ...theirs.Web, ...previewAt(LEFT) } } }, [LEFT, MOVED, GONE]);
      const tailnet = await start(fake);
      expect(tailnet.url).toBe(`https://${HOST}/`);
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, offAt(LEFT), SERVE_STATUS]);
      expect(fake.serve()).toEqual(theirs);
      expect(fake.noted()).toEqual([]);
      expect(fake.said).toEqual([`took https://${HOST}:${LEFT} off your tailnet: a run that ended without cleaning up had left it there.`]);
    });

    test("keeps a leftover it couldn't take off in the ledger, says how to, and still serves the office", inTurn(5), async ({ expect }) => {
      const left = { TCP: { ...OURS.TCP, ...tcp(LEFT) }, Web: { ...OURS.Web, ...previewAt(LEFT) } };
      const fake = fakeTailscale({ serve: left, fail: { serveOff: 'error' } }, [LEFT]);
      const tailnet = await start(fake);
      expect(tailnet.url).toBe(`https://${HOST}/`);
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, offAt(LEFT), SERVE_STATUS, SERVE_STATUS]);
      expect(fake.serve()).toEqual(left);
      expect(fake.noted()).toEqual([LEFT]);
      expect(fake.said).toEqual([
        `an earlier run left https://${HOST}:${LEFT} on your tailnet. Worklings couldn't take https://${HOST}:${LEFT} off your tailnet (error: something broke): run tailscale serve --https=${LEFT} off to do it yourself.`,
      ]);
    });

    test('looks at nothing when the ledger is empty or not one it wrote', inTurn(2), async ({ expect }) => {
      const left = { TCP: { ...OURS.TCP, ...tcp(LEFT) }, Web: { ...OURS.Web, ...previewAt(LEFT) } };
      const fake = fakeTailscale({ serve: left });
      writeTree(fake.dir, { 'ledger/tailnet.json': `{"previews": [${LEFT}` });
      await start(fake);
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
      expect(fake.serve()).toEqual(left);
      expect(fake.said).toEqual([]);
    });
  });

  describe('reads what is already served', () => {
    test('reads null as nothing served, as older releases print it', inTurn(4), async ({ expect }) => {
      const fake = fakeTailscale({ serve: null });
      await start(fake);
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, SERVE_ON, SERVE_STATUS]);
      expect(fake.serve()).toEqual(OURS);
    });

    test('serves again when a leftover handler has lost its HTTPS listener', inTurn(4), async ({ expect }) => {
      const fake = fakeTailscale({ serve: { Web: OURS.Web } });
      await start(fake);
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, SERVE_ON, SERVE_STATUS]);
      expect(fake.serve()).toEqual(OURS);
    });

    test('refuses a serve config it cannot read', inTurn(2), async ({ expect }) => {
      const fake = fakeTailscale({ fail: { serveStatus: 'bad-json' } });
      expect(said(await failureOf(start(fake)))).toEqual({ code: 'bad-output', message: BAD_OUTPUT });
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
    });

    describe('never on the public internet', () => {
      test('refuses an address that Funnel shares', inTurn(2), async ({ expect }) => {
        const serve = { ...at443({ '/': { Proxy: 'http://127.0.0.1:3000' } }), AllowFunnel: { [`${HOST}:443`]: true } };
        const fake = fakeTailscale({ serve });
        expect(said(await failureOf(start(fake)))).toEqual({
          code: 'funnel',
          message: `Tailscale Funnel shares https://${HOST} on the public internet, and Worklings never serves there: turn it off with tailscale funnel --https=443 off, then try again.`,
        });
        expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
        expect(fake.serve()).toEqual(serve);
      });

      test('refuses Funnel on its own leftover too, whatever the case of the name', inTurn(2), async ({ expect }) => {
        const serve = { ...OURS, AllowFunnel: { [`${HOST.toUpperCase()}:443`]: true } };
        const fake = fakeTailscale({ serve });
        expect((await failureOf(start(fake))).code).toBe('funnel');
        expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
        expect(fake.serve()).toEqual(serve);
      });

      test('refuses a tailscale funnel running in a terminal', inTurn(2), async ({ expect }) => {
        const fake = fakeTailscale({ serve: { Foreground: { 'session-1': { ...OURS, AllowFunnel: { [`${HOST}:443`]: true } } } } });
        expect(said(await failureOf(start(fake)))).toEqual({
          code: 'funnel',
          message: `A tailscale funnel running in a terminal shares https://${HOST} on the public internet, and Worklings never serves there: stop it with Ctrl+C, then try again.`,
        });
        expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
      });

      test('takes the office off at once when Funnel comes on as it is added', inTurn(6), async ({ expect }) => {
        const fake = fakeTailscale({ fail: { serveOn: 'also-funnel' } });
        expect((await failureOf(start(fake))).code).toBe('funnel');
        expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, SERVE_ON, SERVE_STATUS, SERVE_STATUS, SERVE_OFF]);
        expect(fake.serve()).toEqual({});
      });
    });

    test.for([
      {
        what: 'a root that leads elsewhere',
        serve: at443({ '/': { Proxy: 'http://127.0.0.1:3000' } }),
        message: `https://${HOST} already serves http://127.0.0.1:3000 on your tailnet, and Worklings won't replace it: remove it with tailscale serve --https=443 off, then try again.`,
      },
      {
        what: 'a root that serves a folder',
        serve: at443({ '/': { Path: 'C:\\Users\\jamie\\site' } }),
        message: `https://${HOST} already serves the files in C:\\Users\\jamie\\site on your tailnet, and Worklings won't replace it: remove it with tailscale serve --https=443 off, then try again.`,
      },
      {
        what: 'another path at the same address',
        serve: at443({ '/': ROOT, '/grafana/': { Proxy: 'http://127.0.0.1:3000' } }),
        message: `https://${HOST}/grafana/ already serves http://127.0.0.1:3000, and the office needs https://${HOST} to itself: remove it with tailscale serve --https=443 --set-path=/grafana/ off, then try again.`,
      },
      {
        what: 'a TCP forward on port 443',
        serve: { TCP: { '443': { TCPForward: '127.0.0.1:5432' } } },
        message: `Port 443 of ${HOST} already forwards TCP to 127.0.0.1:5432, and Worklings won't replace it: remove it with tailscale serve --tcp=443 off, then try again.`,
      },
      {
        what: 'a tailscale serve running in a terminal',
        serve: { Foreground: { 'session-1': at443({ '/': { Proxy: 'http://127.0.0.1:5173' } }) } },
        message: `A tailscale serve running in a terminal already uses https://${HOST}: stop it with Ctrl+C, then try again.`,
      },
    ])('refuses to replace $what', inTurn(2), async ({ serve, message }, { expect }) => {
      const fake = fakeTailscale({ serve });
      expect(said(await failureOf(start(fake)))).toEqual({ code: 'in-use', message });
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS]);
      expect(fake.serve()).toEqual(serve);
    });
  });

  describe('says what to do when it cannot serve', () => {
    test.for([
      {
        what: 'Tailscale is not running',
        setup: { fail: { status: 'not-running' } },
        code: 'not-running',
        message: "Tailscale is installed but isn't running: start Tailscale (or restart the computer), then try again.",
      },
      {
        what: 'nobody is signed in',
        setup: { status: status({ BackendState: 'NeedsLogin', CertDomains: null, CurrentTailnet: null }, { DNSName: '' }) },
        code: 'not-signed-in',
        message: 'Tailscale is installed but not signed in: run tailscale up (or sign in from the Tailscale app), then try again.',
      },
      {
        what: 'Tailscale is disconnected',
        setup: { status: status({ BackendState: 'Stopped' }) },
        code: 'not-connected',
        message: 'Tailscale is signed in but disconnected: run tailscale up (or connect from the Tailscale app), then try again.',
      },
      {
        what: 'Tailscale is still connecting',
        setup: { status: status({ BackendState: 'Starting' }) },
        code: 'not-connected',
        message: 'Tailscale is still connecting: wait a moment, then try again.',
      },
      {
        what: 'another user has Tailscale',
        setup: { status: status({ BackendState: 'InUseOtherUser' }) },
        code: 'not-connected',
        message: 'Tailscale on this computer is in use by another user: sign in to Tailscale as yourself, then try again.',
      },
      {
        what: 'Tailscale is in a state it does not know',
        setup: { status: status({ BackendState: 'Rebooting' }) },
        code: 'not-connected',
        message: "Tailscale isn't connected (it says Rebooting): connect it from the Tailscale app, then try again.",
      },
      {
        what: 'the computer waits for approval',
        setup: { status: status({ BackendState: 'NeedsMachineAuth' }) },
        code: 'needs-approval',
        message: 'This computer is waiting for approval to join your tailnet: approve it on the Machines page of the Tailscale admin console, then try again.',
      },
      {
        what: 'MagicDNS is off',
        setup: { status: status({ CurrentTailnet: { Name: 'robin@example.com', MagicDNSSuffix: 'tail1234.ts.net', MagicDNSEnabled: false }, CertDomains: null }) },
        code: 'no-magicdns',
        message: NO_MAGICDNS,
      },
      {
        what: 'the computer has no DNS name',
        setup: { status: status({}, { DNSName: '' }) },
        code: 'no-magicdns',
        message: NO_MAGICDNS,
      },
      {
        what: 'HTTPS certificates are off',
        setup: { status: status({ CertDomains: null }) },
        code: 'no-https',
        message: `HTTPS certificates are off for your tailnet: turn them on in the DNS page of the Tailscale admin console, then try again (that publishes ${HOST} in public certificate logs).`,
      },
      {
        what: 'Tailscale is older than the serve syntax',
        setup: { status: status({ Version: '1.50.1-t1a2b3c4d5-g6e7f8a9b0' }) },
        code: 'too-old',
        message: 'Tailscale 1.50.1 is too old for --tailnet: update it to 1.52 or later, then try again.',
      },
      {
        what: 'the status is not JSON',
        setup: { fail: { status: 'bad-json' } },
        code: 'bad-output',
        message: BAD_OUTPUT,
      },
      {
        what: 'the status command fails',
        setup: { fail: { status: 'error' } },
        code: 'failed',
        message: 'tailscale status failed (error: something broke): check that Tailscale is connected, then try again.',
      },
    ])('says what to do when $what, and changes nothing', inTurn(1), async ({ setup, code, message }, { expect }) => {
      const fake = fakeTailscale(setup);
      expect(said(await failureOf(start(fake)))).toEqual({ code, message });
      expect(fake.calls()).toEqual([STATUS]);
    });

    test.for([
      {
        what: 'serve fails',
        fail: { serveOn: 'error' },
        code: 'failed',
        message: 'tailscale serve failed (error: something broke): check tailscale serve status, then try again.',
        calls: [STATUS, SERVE_STATUS, SERVE_ON],
      },
      {
        what: 'Tailscale refuses this user',
        fail: { serveOn: 'denied' },
        code: 'denied',
        message:
          "Tailscale didn't let Worklings change what this computer serves: run Worklings as the user signed in to Tailscale (on Linux, run sudo tailscale set --operator=$USER once), then try again.",
        calls: [STATUS, SERVE_STATUS, SERVE_ON],
      },
      {
        what: 'serve prints how to turn HTTPS on and stops',
        fail: { serveOn: 'https-off' },
        code: 'no-https',
        message: `HTTPS certificates are off for your tailnet: open ${ENABLE_LINK}, turn them on, then try again.`,
        calls: [STATUS, SERVE_STATUS, SERVE_ON, SERVE_STATUS],
      },
      {
        what: 'serve ends without adding anything',
        fail: { serveOn: 'no-op' },
        code: 'failed',
        message: `tailscale serve finished but didn't add https://${HOST}: check tailscale serve status, then try again.`,
        calls: [STATUS, SERVE_STATUS, SERVE_ON, SERVE_STATUS],
      },
    ])('says what to do when $what', inTurn(4), async ({ fail, code, message, calls }, { expect }) => {
      const fake = fakeTailscale({ fail });
      expect(said(await failureOf(start(fake)))).toEqual({ code, message });
      expect(fake.calls()).toEqual(calls);
      expect(fake.serve()).toBeUndefined();
    });

    test('refuses a configured path that leads nowhere', async ({ expect }) => {
      const fake = fakeTailscale();
      const exe = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
      const missing = join(fake.dir, exe);
      expect(said(await failureOf(startTailnet({ port: PORT, tailscale: missing, env: fake.env })))).toEqual({
        code: 'not-installed',
        message: `The Tailscale path is set to ${missing}, but there is no file there: set it to the full path of ${exe}, then try again.`,
      });
      expect(fake.calls()).toEqual([]);
    });

    test.for([0, 70_000, 7421.5, Number.NaN])('refuses port %s before running anything', async (port, { expect }) => {
      const fake = fakeTailscale();
      const error = await startTailnet({ port, tailscale: FAKE, env: fake.env }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TailnetError);
      expect(fake.calls()).toEqual([]);
    });
  });

  // A lane of its own: these mostly wait on a fake that sits idle, so they overlap the others without adding load.
  describe('stops what does not answer', () => {
    // Every command may take this long, so the two before the one that waits answer even after a slow start, and the
    // wait itself is what runs out.
    const WAIT_MS = 30_000;
    test('stops serve when it waits for HTTPS to be turned on, and says where to do that', inTurn(3, WAIT_MS), async ({ expect }) => {
      const fake = fakeTailscale({ fail: { serveOn: 'https-off-wait' } });
      expect(said(await failureOf(start(fake, { timeoutMs: WAIT_MS })))).toEqual({
        code: 'no-https',
        message: `HTTPS certificates are off for your tailnet: open ${ENABLE_LINK}, turn them on, then try again.`,
      });
      expect(fake.calls()).toEqual([STATUS, SERVE_STATUS, SERVE_ON]);
      expect(fake.serve()).toBeUndefined();
    });

    // The message alone is asserted: it is the same whether the fake had started when the limit ran out or not.
    test('stops a command that does not answer in time', inTurn(1, 3_000), async ({ expect }) => {
      const fake = fakeTailscale({ fail: { status: 'hang' } });
      expect(said(await failureOf(start(fake, { timeoutMs: 3_000 })))).toEqual({
        code: 'timed-out',
        message: "tailscale status didn't answer within 3 seconds, so Worklings stopped it: check that Tailscale is connected, then try again.",
      });
    });
  });
});
