import { createServer, type AddressInfo, type Server } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE_INSTALL_URL, CLAUDE_SIGN_IN_URL, claudeMissing, claudeStatus, type DoctorCheck, formatDoctor, gitStatus, portState, runDoctor } from '../src/doctor.ts';
import { tempDir, writeTree } from './library-kit.ts';

const fakeClaude = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const fakeTailscale = fileURLToPath(new URL('./fake-tailscale.mjs', import.meta.url));
const HOST = 'office-pc.tail1234.ts.net';

/** This process's environment with the fake Claude Code, answering `auth status` as `auth` says. */
const withClaude = (auth = 'signed-in', more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env, WORKLINGS_CLAUDE: fakeClaude, FAKE_CLAUDE_AUTH: auth, WORKLINGS_HOME: tempDir('worklings-home-'), ...more,
});

/** A PATH with nothing on it, so nothing is found there. */
const nothingOnPath = (): NodeJS.ProcessEnv => {
  const { WORKLINGS_CLAUDE: _c, HEADCOUNT_CLAUDE: _h, WORKLINGS_TAILSCALE: _t, ...rest } = process.env;
  return { ...rest, PATH: tempDir('worklings-path-'), Path: undefined };
};

/** The fake Tailscale CLI with a status of its own, as tailscale status --json prints it. */
function tailscale(status: Record<string, unknown>) {
  const dir = writeTree(tempDir('worklings-tailscale-'), { 'state.json': { status } });
  return { env: { FAKE_TAILSCALE_DIR: dir }, lookup: { found: true as const, command: process.execPath, prefixArgs: [fakeTailscale], path: fakeTailscale } };
}
const RUNNING = { Version: '1.104.5', BackendState: 'Running', Self: { DNSName: `${HOST}.` }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [HOST] };

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))));
});

/** A port something else listens on. */
async function takenPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const port = await takenPort();
  await new Promise<void>((done) => servers.pop()?.close(() => done()));
  return port;
}

const byId = (checks: DoctorCheck[], id: DoctorCheck['id']) => checks.find((c) => c.id === id);

// Each check starts real processes (the fakes, git): a second or more each when the machine is busy.
describe('claudeStatus', { timeout: 60_000 }, () => {
  it('finds Claude Code signed in, with its version and plan, and never the email it prints', async () => {
    const found = await claudeStatus({ env: withClaude() });
    expect(found).toEqual({
      state: 'ready', version: '2.1.312', account: 'your Claude Max plan', perToken: false,
      message: 'Claude Code 2.1.312 is signed in with your Claude Max plan.', fix: null, link: null,
    });
    expect(JSON.stringify(found)).not.toMatch(/example\.com|Organization|00000000/);
  });

  it('says a signed-out Claude Code needs running once, with the sign-in page', async () => {
    expect(await claudeStatus({ env: withClaude('signed-out') })).toMatchObject({
      state: 'signed-out', message: "Claude Code 2.1.312 isn't signed in.", fix: 'Run claude once in a terminal and sign in.', link: CLAUDE_SIGN_IN_URL,
    });
  });

  it('tells an API key apart, since companies then bill per token', async () => {
    expect(await claudeStatus({ env: withClaude('api-key') })).toMatchObject({
      state: 'ready', account: 'an API key', perToken: true, message: 'Claude Code 2.1.312 is signed in with an API key, so companies are billed per token.',
    });
  });

  it('links to the install page when Claude Code is nowhere on the PATH', async () => {
    const missing = await claudeStatus({ env: nothingOnPath() });
    expect(missing).toEqual({
      state: 'missing', version: null, account: null, perToken: false, message: "Claude Code isn't installed, or it isn't on the PATH.",
      fix: `Install it from ${CLAUDE_INSTALL_URL}, then run claude once in a terminal to sign in.`, link: CLAUDE_INSTALL_URL,
    });
    expect(claudeMissing(nothingOnPath())).toEqual(missing);
    expect(claudeMissing(withClaude())).toBeNull();
  });

  it('names the variable when WORKLINGS_CLAUDE leads nowhere', async () => {
    const nowhere = join(tempDir(), 'claude.exe');
    const found = await claudeStatus({ env: { ...nothingOnPath(), WORKLINGS_CLAUDE: nowhere } });
    expect(found.state).toBe('missing');
    expect(found.message).toBe("Worklings can't run the Claude Code that WORKLINGS_CLAUDE names.");
    expect(found.fix).toContain(`WORKLINGS_CLAUDE is set to ${nowhere}, but there is no file there.`);
  });

  it("can't tell the sign-in of a Claude Code without auth status, and says to update it", async () => {
    expect(await claudeStatus({ env: withClaude('no-auth') })).toMatchObject({
      state: 'unknown', version: '2.1.312', message: "Claude Code 2.1.312 can't say whether it's signed in: it has no claude auth status.",
      fix: 'Update it with claude update, or run claude once in a terminal to check.',
    });
    expect((await claudeStatus({ env: withClaude('bad-json') })).message).toBe("Claude Code 2.1.312 answered claude auth status in a form Worklings doesn't read.");
  });

  it('stops waiting for a sign-in that never answers', async () => {
    const started = Date.now();
    expect(await claudeStatus({ env: withClaude('hang'), timeoutMs: 2_000 })).toMatchObject({
      state: 'unknown', message: "Claude Code 2.1.312 didn't say whether it's signed in within 2 seconds.",
    });
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});

describe('gitStatus and portState', { timeout: 60_000 }, () => {
  it('finds git on the PATH, or says where to get it', async () => {
    expect(await gitStatus()).toMatchObject({ found: true, version: expect.stringMatching(/^\d+\.\d+\.\d+$/) as string, fix: null });
    expect(await gitStatus(nothingOnPath())).toEqual({
      found: false, version: null, message: "Git isn't installed, or it isn't on the PATH.",
      fix: 'Install it from https://git-scm.com/downloads: each company works on a git branch of its own.', link: 'https://git-scm.com/downloads',
    });
  });

  it('tells a free port from a taken one', async () => {
    expect(await portState(await freePort())).toBe('free');
    expect(await portState(await takenPort())).toBe('taken');
  });
});

describe('runDoctor', { timeout: 90_000 }, () => {
  it('passes when everything is there, a line per check', async () => {
    const port = await freePort();
    const fake = tailscale(RUNNING);
    const report = await runDoctor({ env: withClaude('signed-in', fake.env), hubPort: port, tailscale: fake.lookup });
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => [c.id, c.state])).toEqual([
      ['node', 'ok'], ['claude', 'ok'], ['sign-in', 'ok'], ['git', 'ok'], ['hub-port', 'ok'], ['tailnet-port', expect.stringMatching(/ok|warn/) as string], ['tailscale', 'ok'],
    ]);
    expect(byId(report.checks, 'sign-in')?.line).toBe('Signed in to Claude Code with your Claude Max plan.');
    expect(byId(report.checks, 'tailscale')?.line).toBe(`Tailscale is ready: npx worklings --tailnet puts the hub on https://${HOST}.`);
    const text = formatDoctor(report);
    expect(text).toMatch(/^Worklings doctor\n\n {2}ok {4}Node\.js \d+\.\d+\.\d+\.\n {2}ok {4}Claude Code 2\.1\.312\.\n/);
    expect(text.trimEnd().split('\n').at(-1)).toBe('Everything Worklings needs is here. Run npx worklings to open the lobby.');
  });

  it('fails on a signed-out Claude Code, an old Node and no git, each with its one fix', async () => {
    const report = await runDoctor({
      env: { ...withClaude('signed-out'), PATH: tempDir('worklings-path-'), Path: undefined }, hubPort: await freePort(), nodeVersion: '20.11.1',
      tailscale: { found: false, reason: 'not here' },
    });
    expect(report.ok).toBe(false);
    expect(byId(report.checks, 'node')).toEqual({
      id: 'node', state: 'fail', required: true, line: 'Node.js 20.11.1 is too old: Worklings needs 22 or newer.', fix: 'Install the current LTS from https://nodejs.org.',
    });
    expect(byId(report.checks, 'sign-in')).toMatchObject({ state: 'fail', line: "Claude Code isn't signed in.", fix: 'Run claude once in a terminal and sign in.' });
    expect(byId(report.checks, 'git')).toMatchObject({ state: 'fail', fix: 'Install it from https://git-scm.com/downloads: each company works on a git branch of its own.' });
    expect(byId(report.checks, 'tailscale')).toMatchObject({ state: 'off', required: false, line: "Tailscale isn't installed. It's optional: it puts the hub on your phone." });
    const text = formatDoctor(report);
    expect(text).toContain("  fail  Claude Code isn't signed in.\n        Run claude once in a terminal and sign in.\n");
    expect(text.trimEnd().split('\n').at(-1)).toBe('3 things to fix before companies can run. The demo works without them: npx worklings demo.');
  });

  it('fails on a missing Claude Code with the install page, and warns on an old one', async () => {
    const missing = await runDoctor({ env: { ...nothingOnPath(), WORKLINGS_HOME: tempDir('worklings-home-') }, hubPort: await freePort(), tailscale: { found: false, reason: 'not here' } });
    expect(missing.checks.filter((c) => c.id === 'claude' || c.id === 'sign-in')).toEqual([
      { id: 'claude', state: 'fail', required: true, line: "Claude Code isn't installed, or it isn't on the PATH.", fix: `Install it from ${CLAUDE_INSTALL_URL}, then run claude once in a terminal to sign in.` },
    ]);
    const old = await runDoctor({ env: withClaude('signed-in', { FAKE_CLAUDE_VERSION: '2.0.9' }), hubPort: await freePort(), tailscale: { found: false, reason: 'not here' } });
    expect(old.ok).toBe(true);
    expect(byId(old.checks, 'claude')).toMatchObject({ state: 'warn', line: 'Claude Code 2.0.9 is older than 2.1.312, the version Worklings is tested with.', fix: 'Update it with claude update.' });
  });

  it('warns about a hub port something else holds, and says which port to use instead', async () => {
    const port = await takenPort();
    const report = await runDoctor({ env: withClaude(), hubPort: port, tailscale: { found: false, reason: 'not here' } });
    expect(report.ok).toBe(true);
    expect(byId(report.checks, 'hub-port')).toEqual({
      id: 'hub-port', state: 'warn', required: false, line: `Something else is using port ${port}, the hub's port.`, fix: `Start the hub on another port: npx worklings --port ${port + 10}.`,
    });
  });

  it('says a running hub holds the port rather than warning about it', async () => {
    const port = await takenPort();
    const home = writeTree(tempDir('worklings-home-'), { '.worklings/hub.lock': { pid: process.pid, port } });
    const report = await runDoctor({ env: { ...withClaude(), WORKLINGS_HOME: home }, hubPort: port, tailscale: { found: false, reason: 'not here' } });
    expect(report.checks.filter((c) => c.id === 'hub-port' || c.id === 'tailnet-port')).toEqual([
      { id: 'hub-port', state: 'ok', required: false, line: `A Worklings hub is already running on port ${port}.`, fix: null },
    ]);
  });

  it('gives Tailscale the line and fix its own sentence holds', async () => {
    const fake = tailscale({ ...RUNNING, BackendState: 'NeedsLogin' });
    const report = await runDoctor({ env: withClaude('signed-in', fake.env), hubPort: await freePort(), tailscale: fake.lookup });
    expect(byId(report.checks, 'tailscale')).toEqual({
      id: 'tailscale', state: 'warn', required: false, line: 'Tailscale is installed but not signed in.',
      fix: 'Run tailscale up (or sign in from the Tailscale app), then try again.',
    });
  });
});
