import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStudio } from '../src/core/studio.ts';
import { HOOK_EVENTS } from '../src/server/hooks-config.ts';
import { SESSION } from './fixtures.ts';
import { project } from './projects.ts';
import { miniLibrary, tempDir, writeTree } from './library-kit.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
/** What package.json's bin runs: the Node check, then the CLI. */
const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const transcripts = fileURLToPath(new URL('./fixtures/claude-2.1.312/transcripts/', import.meta.url));
const home = tempDir('worklings-home-');
/** The stand-in for Claude Code, signed in: `new` checks it before it starts a company, and no test reaches the real one. */
const fakeClaude = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const env: NodeJS.ProcessEnv = { ...process.env, WORKLINGS_HOME: home, WORKLINGS_CLAUDE: fakeClaude };
// These tests may run inside Claude Code, which would make the CLI leave tokens out of its links.
delete env.CLAUDECODE;
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
const runStatus = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
const mini = miniLibrary();

// What versions from before the rename (the tool was called Headcount) left behind, and must keep working.
const LEGACY_HOME_ENV = 'HEADCOUNT_HOME';
const LEGACY_TOKEN_FILE = '.headcount/token';
const LEGACY_HOOKS = (port: number) =>
  Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks?from=headcount`, timeout: 2 }] }]]));

/** Everything a started command printed, once `until` shows up in it. */
function printed(child: ReturnType<typeof spawn>, until: RegExp): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      text += chunk.toString();
      if (until.test(text)) resolve(text);
    });
    child.on('exit', (code) => reject(new Error(`exited with ${code}: ${text}`)));
  });
}

/** A port nothing listens on right now, for a test that has to know the office's port before it starts. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

describe('cli', () => {
  it('prints usage for --help and the version for --version', () => {
    const usage = run('--help');
    expect(usage).toMatch(/^worklings \d+\.\d+\.\d+\n/);
    expect(usage).toContain('worklings new [dir]');
    expect(usage).toContain('worklings hub ');
    expect(usage).toContain('worklings new [dir] --prompt <text>');
    expect(usage).toContain('--tailnet');
    expect(usage).not.toMatch(/headcount/i);
    expect(run('--version').trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('ships as the worklings command, behind a check of the Node version', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { name: string; bin: unknown; engines: unknown };
    expect(pkg.name).toBe('worklings');
    expect(pkg.bin).toEqual({ worklings: 'dist/bin.js' });
    expect(pkg.engines).toEqual({ node: '>=22' });
    expect(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8', env }).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('tells an older Node what it needs in a sentence, instead of failing on syntax', () => {
    const preload = writeTree(tempDir(), { 'node-20.mjs': "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '20.11.1' } });\n" });
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(preload, 'node-20.mjs')).href, bin, '--version'], { encoding: 'utf8', env });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Worklings needs Node.js 22 or newer, and this is Node.js 20.11.1. Install the current LTS from https://nodejs.org, then run the command again.\n');
  });

  it('shows the help for help, and says what an unknown command is not', () => {
    expect(run('help')).toBe(run('--help'));
    expect(run('help')).toContain('Changed in this version: `worklings` alone opens the hub');
    const typo = runStatus('hubb');
    expect(typo.status).toBe(2);
    expect(typo.stderr).toMatch(/^"hubb" isn't a Worklings command, or a folder here\. Did you mean `worklings hub`\?\nCommands: hub, demo, doctor, new, office, /);
    expect(runStatus('frobnicate').stderr).not.toContain('Did you mean');
    expect(runStatus('./no-such-folder').stderr).toContain('No such folder:');
  });

  it('points --lan alone at the office, now that the hub is the default', () => {
    const result = runStatus('--lan', '--no-open');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Use `worklings office --lan` for the office that watches this folder on your network');
  });

  it('detects a project as JSON', () => {
    const d = JSON.parse(run('detect', project('expo'), '--json', '--library', mini)) as { stacks: string[]; domains: { id: string }[] };
    expect(d.stacks).toContain('expo');
    expect(d.domains[0]?.id).toBe('mini-app');
  });

  it('generates a studio, and a dry run writes nothing', () => {
    const root = project('expo');
    const dry = JSON.parse(run('new', root, '--library', mini, '--dry-run', '--json')) as { domain: string; result: { written: string[] } };
    expect(dry.domain).toBe('mini-app');
    expect(dry.result.written).toContain('.claude/studio.yaml');
    expect(existsSync(join(root, '.claude/studio.yaml'))).toBe(false);
    const text = run('new', root, '--library', mini, '--idea', 'Plant care with streaks');
    expect(text).toContain('Detected a mini app (depends on expo, has app.json).');
    expect(text).toContain('Wrote');
    expect(parseStudio(readFileSync(join(root, '.claude/studio.yaml'), 'utf8')).ok).toBe(true);
    expect(run('new', root, '--library', mini)).toContain('already up to date');
  });

  it('keeps a fired role fired when new runs again', () => {
    const root = project('expo');
    run('new', root, '--library', mini);
    run('fire', 'qa-engineer', root, '--library', mini);
    const again = run('new', root, '--library', mini);
    expect(again).toContain('Left out qa-engineer: fired earlier.');
    expect(again).not.toContain('+ .claude/agents/qa-engineer.md');
    expect(existsSync(join(root, '.claude/agents/qa-engineer.md'))).toBe(false);
    expect(run('rehire', 'qa-engineer', root, '--library', mini)).toContain('Rehired the QA engineer.');
    // Named on purpose, a fired role is hired fresh and leaves the fired list.
    run('fire', 'qa-engineer', root, '--library', mini);
    const added = JSON.parse(run('new', root, '--library', mini, '--add', 'qa-engineer', '--dry-run', '--json')) as { studio: { fired: unknown[]; roles: { id: string }[] } };
    expect(added.studio.fired).toEqual([]);
    expect(added.studio.roles.map((r) => r.id)).toContain('qa-engineer');
  });

  it('asks for a domain when the folder has no code', () => {
    const result = runStatus('new', tempDir(), '--library', mini);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('This folder has no code yet, so pass --domain.');
  });

  it('installs, reports and removes the office hooks without touching other settings', () => {
    const root = writeTree(tempDir(), { '.claude/settings.local.json': { permissions: { allow: ['Bash(npm test)'] } }, '.git/': '' });
    mkdirSync(join(root, '.git'), { recursive: true });
    expect(run('hooks', 'install', root, '--port', '7500', '--yes')).toContain('Installed office hooks for port 7500 in .claude/settings.local.json (and added it to .gitignore).');
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf8')) as { permissions: unknown; hooks: Record<string, unknown[]> };
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test)'] });
    expect(settings.hooks.PreToolUse).toEqual([{ hooks: [{ type: 'http', url: 'http://127.0.0.1:7500/hooks?from=worklings', timeout: 2 }], matcher: '*' }]);
    expect(settings.hooks.SessionStart).toBeUndefined();
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.claude/settings.local.json\n');
    expect(run('hooks', 'status', root)).toContain('for port 7500 (17 events)');
    run('hooks', 'install', root, '--port', '7501', '-y');
    expect(JSON.parse(run('hooks', 'status', root, '--json'))).toMatchObject({ installed: true, port: 7501 });
    expect(run('hooks', 'uninstall', root)).toContain('Removed 17 office hook(s)');
    expect(JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf8'))).toEqual({ permissions: { allow: ['Bash(npm test)'] } });
  });

  it('asks before it writes hooks, and writes nothing when nobody can answer', () => {
    const root = writeTree(tempDir(), { '.git/': '' });
    const piped = runStatus('hooks', 'install', root);
    expect(piped.status).toBe(1);
    expect(piped.stderr).toBe(
      'Installing hooks changes .claude/settings.local.json, so Worklings asks first, and nobody can answer here. Run it in a terminal, or pass --yes to agree.\n',
    );
    const scripted = runStatus('hooks', 'install', root, '--json');
    expect(scripted.status).toBe(1);
    expect(scripted.stderr).toBe('Pass --yes with --json: Worklings asks before it writes hooks, and --json leaves nobody to ask.\n');
    expect(readdirSync(root)).toEqual(['.git']);
    expect(JSON.parse(run('hooks', 'install', root, '--json', '--yes'))).toMatchObject({ installed: true, port: 7421, gitignoreUpdated: true });
  });

  it('refuses to edit a settings file that is not valid JSON', () => {
    const root = writeTree(tempDir(), { '.claude/settings.local.json': '{ broken' });
    const result = runStatus('hooks', 'install', root, '--yes');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not a JSON object, so Worklings won't touch it");
  });

  it("won't install hooks through a .claude folder a cloned repo links elsewhere", () => {
    const root = writeTree(tempDir(), { '.git/': '' });
    const elsewhere = tempDir();
    // A directory junction on Windows (no special rights needed), a symlink elsewhere.
    symlinkSync(elsewhere, join(root, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = runStatus('hooks', 'install', root, '--yes');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".claude is a symlink or junction; Worklings doesn't read or write through links.");
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('says how to update the hooks an earlier version installed, on the same port', () => {
    const root = writeTree(tempDir(), { '.claude/settings.local.json': { hooks: LEGACY_HOOKS(7500) } });
    expect(run('hooks', 'status', root)).toBe(
      'Office hooks installed in .claude/settings.local.json for port 7500 (17 events).\n' +
        'The hooks an earlier version installed still work; `worklings hooks install --port 7500` updates them.\n',
    );
    expect(JSON.parse(run('hooks', 'status', root, '--json'))).toMatchObject({ installed: true, port: 7500, legacy: true });
    run('hooks', 'install', root, '--port', '7500', '--yes');
    expect(JSON.parse(run('hooks', 'status', root, '--json'))).toMatchObject({ installed: true, port: 7500, legacy: false });
  });

  it('adopts an existing set of agents and writes studio.yaml on request', () => {
    const root = writeTree(tempDir(), {
      '.claude/agents/game/game-designer.md': '---\nname: game-designer\ndescription: Designs the game.\n---\nBody',
      '.claude/agents/qa-lead.md': '---\nname: qa-lead\ndescription: Owns testing.\n---\nBody',
      '.claude/skills/design-review/SKILL.md': '---\nname: design-review\ndescription: Reviews designs.\n---\nBody',
    });
    const text = run('adopt', root, '--write');
    expect(text).toContain('2 roles in');
    expect(text).toContain('Design: game-designer');
    const studio = parseStudio(readFileSync(join(root, '.claude/studio.yaml'), 'utf8'));
    expect(studio.ok && studio.studio.gates.map((g) => g.id)).toEqual(['design-review']);
  });

  it('opens an office that answers on the port it prints', async () => {
    const root = project('expo');
    const child = spawn(process.execPath, [cli, 'office', root, '--port', '0', '--no-open', '--library', mini], { env });
    try {
      const link = await new Promise<string>((resolve, reject) => {
        let text = '';
        child.stdout.on('data', (chunk: Buffer) => {
          text += chunk.toString();
          const m = /Open: (\S+)/.exec(text);
          if (m?.[1]) resolve(m[1]);
        });
        child.on('exit', (code) => reject(new Error(`office exited with ${code}: ${text}`)));
      });
      expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]{32,}$/);
      const res = await fetch(new URL(`/api/state?token=${new URL(link).searchParams.get('token') ?? ''}`, link));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { project: { name: string } }).project.name).toBe('plant-pal');
      expect(readFileSync(join(home, '.worklings', 'token'), 'utf8').trim()).toBe(new URL(link).searchParams.get('token'));
    } finally {
      child.kill();
    }
  });

  it('keeps an office link from an earlier version working', async () => {
    const oldToken = 'bookmarked-before-the-rename-0123456789';
    const legacyHome = writeTree(tempDir('worklings-home-'), { [LEGACY_TOKEN_FILE]: `${oldToken}\n` });
    const { WORKLINGS_HOME: _current, ...withoutHome } = env;
    const child = spawn(process.execPath, [cli, 'office', project('expo'), '--port', '0', '--no-open', '--library', mini], {
      env: { ...withoutHome, [LEGACY_HOME_ENV]: legacyHome },
    });
    try {
      const link = /Open: (\S+)\n/.exec(await printed(child, /Open: \S+\n/))?.[1] ?? '';
      expect(new URL(link).searchParams.get('token')).toBe(oldToken);
      expect((await fetch(new URL(`/api/state?token=${oldToken}`, link))).status).toBe(200);
      expect((await fetch(new URL(`/api/state?token=${oldToken.replace('0', '1')}`, link))).status).toBe(401);
      expect(readFileSync(join(legacyHome, '.worklings', 'token'), 'utf8')).toBe(`${oldToken}\n`);
      expect(readFileSync(join(legacyHome, LEGACY_TOKEN_FILE), 'utf8')).toBe(`${oldToken}\n`);
    } finally {
      child.kill();
    }
  });

  it('mentions the hooks an earlier version installed when the office opens', async () => {
    const root = project('expo');
    const port = await freePort();
    writeTree(root, { '.claude/settings.local.json': { hooks: LEGACY_HOOKS(port) } });
    const child = spawn(process.execPath, [cli, 'office', root, '--port', String(port), '--no-open', '--library', mini], { env });
    try {
      expect(await printed(child, /Press Ctrl\+C to stop\./)).toContain(
        `  Live: hooks installed for port ${port}\n` +
          `  The hooks an earlier version installed still work; \`worklings hooks install --port ${port}\` updates them.\n`,
      );
    } finally {
      child.kill();
    }
  });

  it('opens the office for a folder named on its own, as before the hub was the default', async () => {
    const root = project('expo');
    const child = spawn(process.execPath, [cli, root, '--port', '0', '--no-open', '--library', mini], { env });
    try {
      expect(await printed(child, /Press Ctrl\+C to stop\./)).toMatch(/^Worklings office for plant-pal /);
    } finally {
      child.kill();
    }
  });

  it('adds the hooks when the office opens with --yes, and leaves the settings alone without it', async () => {
    const root = writeTree(project('expo'), { '.git/': '' });
    const port = await freePort();
    const piped = spawn(process.execPath, [cli, 'office', root, '--port', String(port), '--no-open', '--library', mini], { env });
    try {
      expect(await printed(piped, /Press Ctrl\+C to stop\./)).toContain('Live: hooks not installed. Run `worklings hooks install` to watch sessions as they happen.');
      expect(existsSync(join(root, '.claude', 'settings.local.json'))).toBe(false);
    } finally {
      piped.kill();
    }
    const agreed = spawn(process.execPath, [cli, 'office', root, '--port', String(await freePort()), '--yes', '--no-open', '--library', mini], { env });
    try {
      const text = await printed(agreed, /Press Ctrl\+C to stop\./);
      const officePort = /Installed office hooks for port (\d+)/.exec(text)?.[1];
      expect(text).toContain(`Installed office hooks for port ${officePort} in .claude/settings.local.json (and added it to .gitignore).\n`);
      expect(text).toContain(`  Live: hooks installed for port ${officePort}\n`);
      expect(JSON.parse(run('hooks', 'status', root, '--json'))).toMatchObject({ installed: true, port: Number(officePort) });
    } finally {
      agreed.kill();
    }
  });

  it('checks this computer with doctor, and exits 1 when something required is missing', () => {
    const doctorEnv = { ...env, WORKLINGS_CLAUDE: fileURLToPath(new URL('./fake-claude.mjs', import.meta.url)), WORKLINGS_TAILSCALE: '' };
    const passing = spawnSync(process.execPath, [cli, 'doctor', '--json'], { encoding: 'utf8', env: { ...doctorEnv, FAKE_CLAUDE_AUTH: 'signed-in' }, timeout: 60_000 });
    expect(passing.status).toBe(0);
    const report = JSON.parse(passing.stdout) as { ok: boolean; checks: { id: string; state: string }[] };
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['node', 'claude', 'sign-in', 'git', 'hub-port', 'tailscale']));
    const failing = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env: { ...doctorEnv, FAKE_CLAUDE_AUTH: 'signed-out' }, timeout: 60_000 });
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain("  fail  Claude Code isn't signed in.\n        Run claude once in a terminal and sign in.\n");
    expect(failing.stderr).toContain('Checking this computer.');
  }, 120_000);
});

describe('cli demo and replay', () => {
  async function linkFrom(child: ReturnType<typeof spawn>): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let text = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        const m = /Open: (\S+)/.exec(text);
        if (m?.[1]) resolve(m[1]);
      });
      child.on('exit', (code) => reject(new Error(`exited with ${code}: ${text}`)));
    });
  }

  it('runs the demo with no Claude Code involved, opening the demo company', async () => {
    const child = spawn(process.execPath, [cli, 'demo', '--port', '0', '--no-open'], { env });
    try {
      const link = await linkFrom(child);
      expect(new URL(link).pathname).toBe('/c/demo');
      const state = (await (await fetch(new URL('/api/state', link))).json()) as { mode: string; studio: { roles: unknown[] }; agents: unknown[] };
      expect(state.mode).toBe('demo');
      expect(state.studio.roles.length).toBeGreaterThanOrEqual(7);
      expect(state.agents.length).toBeGreaterThanOrEqual(1);
      const catalog = (await (await fetch(new URL('/api/studio', link))).json()) as { rules: { body: string }[] };
      expect(catalog.rules.length).toBeGreaterThan(0);
      const change = await fetch(new URL('/api/reshape', link), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${new URL(link).searchParams.get('token')}` }, body: '{"action":"fire","role":"copywriter"}' });
      expect(change.status).toBe(404);
    } finally {
      child.kill();
    }
  });

  it('explains when a project has no recorded sessions to replay', () => {
    const result = runStatus('replay', tempDir());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No Claude Code sessions recorded for');
  });

  it('stops a replay with a bad speed before it opens anything', () => {
    const config = tempDir('worklings-claude-');
    const root = tempDir();
    const dir = join(config, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(dir, { recursive: true });
    cpSync(join(transcripts, 'main.jsonl'), join(dir, `${SESSION}.jsonl`));
    const result = spawnSync(process.execPath, [cli, 'replay', root, '--speed', '0', '--port', '0', '--no-open'], {
      encoding: 'utf8', env: { ...env, CLAUDE_CONFIG_DIR: config }, timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--speed must be a number above 0 and up to 600, got 0');
  });
});

describe('cli hub and companies', () => {
  /** The CLI as a child that may take its time, so a stand-in hub in this process can answer it. */
  function runLater(...args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, ...args], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });
  }

  /** A stand-in for a hub already running: it answers POST /api/companies as told and keeps what it was sent. */
  async function standIn(status: number, answer: unknown) {
    const seen: { method?: string; path?: string; auth?: string; body: unknown }[] = [];
    const server = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: JSON.parse(body || 'null') as unknown });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return { port: (server.address() as AddressInfo).port, seen, close: () => new Promise<void>((done) => server.close(() => done())) };
  }

  it('starts a company through the hub that answers on the port, and prints its link', async () => {
    const hub = await standIn(201, { id: 'plant-pal', reopened: false });
    try {
      const folder = tempDir();
      const result = await runLater('new', folder, '--prompt', '  A plant care app with watering streaks ', '--port', String(hub.port), '--no-open');
      const token = readFileSync(join(home, '.worklings', 'token'), 'utf8').trim();
      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect(result.stdout).toBe(`Started a job in ${folder}.\n  Open: http://127.0.0.1:${hub.port}/c/plant-pal/progress?token=${token}\n`);
      // v0.7: no launch choices named, so every one is left to the person's own Claude Code.
      expect(hub.seen).toEqual([{ method: 'POST', path: '/api/companies', auth: `Bearer ${token}`, body: { folder, prompt: 'A plant care app with watering streaks', launch: { model: null, effort: null, permissionMode: null, planFirst: false }, work: 'plain' } }]);
    } finally {
      await hub.close();
    }
  });

  it('sends the packs --pack names (repeated or comma-separated, each once), and refuses a name that is not a pack or a team with packs', async () => {
    const hub = await standIn(201, { id: 'plant-pal', reopened: false });
    try {
      const folder = tempDir();
      const result = await runLater('new', folder, '--prompt', 'A plant care app', '--pack', 'kickoff,kickoff', '--pack', 'kickoff', '--port', String(hub.port), '--no-open');
      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect((hub.seen[0]?.body as { packs?: unknown }).packs).toEqual(['kickoff']);
      const odd = await runLater('new', tempDir(), '--prompt', 'A plant care app', '--pack', 'from-github', '--port', String(hub.port), '--no-open');
      expect([odd.code, odd.stderr]).toEqual([1, '"from-github" isn\'t a pack. The packs are kickoff.\n']);
      const team = await runLater('new', tempDir(), '--prompt', 'A plant care app', '--pack', 'kickoff', '--team', '--port', String(hub.port), '--no-open');
      expect(team.code).toBe(1);
      expect(team.stderr).toContain('Packs are for a one-session job');
      expect(hub.seen).toHaveLength(1);
    } finally {
      await hub.close();
    }
  });

  it("says what the hub refused, and what isn't a hub", async () => {
    const refusing = await standIn(409, { error: 'Café Lumen already runs here. Open it from the lobby.', code: 'exists' });
    const other = await standIn(404, { error: 'No such endpoint.' });
    try {
      const refused = await runLater('new', tempDir(), '--prompt', 'A café site', '--port', String(refusing.port), '--no-open');
      expect([refused.code, refused.stderr]).toEqual([1, 'Café Lumen already runs here. Open it from the lobby.\n']);
      const wrong = await runLater('new', tempDir(), '--prompt', 'A café site', '--port', String(other.port), '--no-open');
      expect([wrong.code, wrong.stderr]).toEqual([1, `Something other than a Worklings hub answers on port ${other.port}. Pass --port with the hub's port.\n`]);
    } finally {
      await refusing.close();
      await other.close();
    }
  });

  it("won't start a company without a Claude Code that is found and signed in, and says what to do", async () => {
    const hub = await standIn(201, { id: 'plant-pal', reopened: false });
    try {
      const { WORKLINGS_CLAUDE: _w, HEADCOUNT_CLAUDE: _h, ...rest } = env;
      const missing = await runWith(
        { ...rest, PATH: tempDir('worklings-path-'), Path: undefined },
        'new', tempDir(), '--prompt', 'A café site', '--port', String(hub.port), '--no-open',
      );
      expect([missing.code, missing.stdout]).toEqual([1, '']);
      expect(missing.stderr).toContain("Claude Code isn't installed");
      expect(missing.stderr).toContain('No company was started; `worklings demo` shows one meanwhile.');

      const signedOut = await runWith({ ...env, FAKE_CLAUDE_AUTH: 'signed-out' }, 'new', tempDir(), '--prompt', 'A café site', '--port', String(hub.port), '--no-open');
      expect([signedOut.code, signedOut.stdout]).toEqual([1, '']);
      expect(signedOut.stderr).toBe("Claude Code 2.1.312 isn't signed in. Run claude once in a terminal and sign in. No company was started; `worklings demo` shows one meanwhile.\n");
      // Neither reached the hub.
      expect(hub.seen).toEqual([]);
    } finally {
      await hub.close();
    }
  });

  it("needs something to build, and keeps v1's composer for --offline", () => {
    const empty = runStatus('new', tempDir(), '--prompt', '   ', '--no-open');
    expect([empty.status, empty.stderr]).toEqual([1, 'Say what to build, e.g. `worklings new --prompt "A bilingual café website with pickup orders"`.\n']);
    // v0.4: a first prompt may be up to 64,000 characters, more than a Windows command line carries, so the limit is
    // checked over HTTP (test/hub-server.test.ts), where long prompts arrive.
    const offline = JSON.parse(run('new', project('expo'), '--offline', '--prompt', 'Plant care', '--library', mini, '--dry-run', '--json')) as { domain: string };
    expect(offline.domain).toBe('mini-app');
  });

  it('opens the lobby on the port it prints, with every part the hub runs', async () => {
    const hubHome = tempDir('worklings-home-');
    const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
    // No company, so no desk opens; the fake stands in all the same.
    const child = spawn(process.execPath, [cli, 'hub', '--port', '0', '--no-open'], { env: { ...env, WORKLINGS_HOME: hubHome, WORKLINGS_CLAUDE: fake } });
    try {
      const text = await printed(child, /Press Ctrl\+C to stop\./);
      expect(text).toContain('Worklings hub: no companies yet\n');
      const link = /Open: (\S+)\n/.exec(text)?.[1] ?? '';
      expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]{32,}$/);
      const lobby = await fetch(new URL('/api/lobby', link), { headers: { authorization: `Bearer ${new URL(link).searchParams.get('token') ?? ''}` } });
      expect(await lobby.json()).toMatchObject({ companies: [], hub: { maxDesks: 8, working: 0 } });
      expect(JSON.parse(readFileSync(join(hubHome, '.worklings', 'hub.lock'), 'utf8'))).toMatchObject({ port: Number(new URL(link).port) });
      expect(existsSync(join(hubHome, '.worklings', 'hub.key'))).toBe(true);
    } finally {
      child.kill();
    }
  });

  it('opens the hub with no command at all, offering the demo company on a first run', async () => {
    const hubHome = tempDir('worklings-home-');
    const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
    const child = spawn(process.execPath, [bin, '--port', '0', '--no-open'], { env: { ...env, WORKLINGS_HOME: hubHome, WORKLINGS_CLAUDE: fake } });
    try {
      const text = await printed(child, /Press Ctrl\+C to stop\./);
      expect(text).toMatch(/^Worklings hub: no companies yet\n {2}Open: http:\/\/127\.0\.0\.1:(\d+)\/\?token=[\w-]{32,}\n {2}The demo company, made up and free: http:\/\/127\.0\.0\.1:\1\/c\/demo\?token=[\w-]{32,}\n/);
      expect(text).not.toContain("isn't installed");
      // The demo company is the web app's own page: the hub answers its address as it answers the lobby's.
      const link = /Open: (\S+)\n/.exec(text)?.[1] ?? '';
      const [lobby, demo] = await Promise.all(['/', '/c/demo'].map(async (path) => fetch(new URL(path, link)).then(async (r) => [r.status, r.headers.get('content-type'), await r.text()])));
      expect(demo).toEqual(lobby);
    } finally {
      child.kill();
    }
  });

  it('says how to get Claude Code when the hub starts without it, and starts all the same', async () => {
    const { WORKLINGS_CLAUDE: _w, HEADCOUNT_CLAUDE: _h, ...rest } = process.env;
    const child = spawn(process.execPath, [cli, 'hub', '--port', '0', '--no-open'], {
      env: { ...rest, WORKLINGS_HOME: tempDir('worklings-home-'), PATH: tempDir('worklings-path-'), Path: undefined },
    });
    try {
      expect(await printed(child, /Press Ctrl\+C to stop\./)).toContain(
        "  Claude Code isn't installed, or it isn't on the PATH. Install it from https://code.claude.com/docs/en/setup, then run claude once in a terminal to sign in. Until then the demo company works, and new companies can't start.\n",
      );
    } finally {
      child.kill();
    }
  });

  it('opens the hub that already runs instead of failing on its port', () => {
    const hubHome = writeTree(tempDir('worklings-home-'), { '.worklings/hub.lock': { pid: process.pid, port: 4380 } });
    const result = spawnSync(process.execPath, [cli, '--no-open'], { encoding: 'utf8', env: { ...env, WORKLINGS_HOME: hubHome } });
    const token = readFileSync(join(hubHome, '.worklings', 'token'), 'utf8').trim();
    expect([result.status, result.stderr]).toEqual([0, '']);
    expect(result.stdout).toBe(
      'A Worklings hub is already running on port 4380.\n' +
        `  Open: http://127.0.0.1:4380/?token=${token}\n` +
        '  To start it again with other options, stop it first (Ctrl+C where it runs).\n',
    );
  });

  it("leaves the token out of the links it prints when it runs inside Claude Code, and says the browser has it", () => {
    const hubHome = writeTree(tempDir('worklings-home-'), { '.worklings/hub.lock': { pid: process.pid, port: 4380 } });
    const inside = spawnSync(process.execPath, [cli, '--no-open'], { encoding: 'utf8', env: { ...env, WORKLINGS_HOME: hubHome, CLAUDECODE: '1' } });
    const token = readFileSync(join(hubHome, '.worklings', 'token'), 'utf8').trim();
    expect([inside.status, inside.stderr]).toEqual([0, '']);
    expect(inside.stdout).not.toContain(token);
    expect(inside.stdout).toContain('  Open: http://127.0.0.1:4380/\n');
    expect(inside.stdout).toContain('Run `worklings` in a terminal to open it with the token.');
  });

  it('prints the demo links without the token inside Claude Code, and with it in a terminal', async () => {
    const demoHome = tempDir('worklings-home-');
    for (const insideClaude of [true, false]) {
      const child = spawn(process.execPath, [cli, 'demo', '--port', '0', '--no-open'], { env: { ...env, WORKLINGS_HOME: demoHome, ...(insideClaude ? { CLAUDECODE: '1' } : {}) } });
      try {
        const text = await printed(child, /Press Ctrl\+C to stop\./);
        const token = readFileSync(join(demoHome, '.worklings', 'token'), 'utf8').trim();
        expect(text.includes(token)).toBe(!insideClaude);
        expect(text).toMatch(/Open: http:\/\/127\.0\.0\.1:\d+\/c\/demo(\?token=|\n)/);
      } finally {
        child.kill();
      }
    }
  });

  /** The CLI as a child with an environment of its own, so a stand-in in this process can answer it meanwhile. */
  function runWith(childEnv: NodeJS.ProcessEnv, ...args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, ...args], { env: childEnv });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });
  }

  it('stops the hub that runs here by the process its lock names, and the hub closes as on Ctrl+C', async () => {
    const hubEnv = { ...env, WORKLINGS_HOME: tempDir('worklings-home-'), WORKLINGS_CLAUDE: fileURLToPath(new URL('./fake-claude.mjs', import.meta.url)) };
    const hub = spawn(process.execPath, [cli, 'hub', '--port', '0', '--no-open'], { env: hubEnv });
    const hubExit = new Promise<number | null>((done) => hub.on('exit', (code) => done(code)));
    try {
      const port = /Open: http:\/\/127\.0\.0\.1:(\d+)\//.exec(await printed(hub, /Press Ctrl\+C to stop\./))?.[1];
      const stopped = await runWith(hubEnv, 'hub', '--stop');
      expect(stopped).toEqual({
        code: 0, stderr: '', stdout: `Stopping the Worklings hub on port ${port} (process ${hub.pid}): it closes every company's desks first.\nStopped.\n`,
      });
      expect(await hubExit).toBe(0);
      expect(await runWith(hubEnv, '--stop')).toEqual({ code: 0, stderr: '', stdout: 'No Worklings hub is running on this computer.\n' });
    } finally {
      hub.kill();
    }
  });

  it("won't stop the process a lock names unless it answers as that hub", async () => {
    const other = await standIn(200, { ok: true, app: 'worklings-hub', pid: process.pid + 1 });
    try {
      const hubHome = writeTree(tempDir('worklings-home-'), { '.worklings/hub.lock': { pid: process.pid, port: other.port } });
      const refused = await runWith({ ...env, WORKLINGS_HOME: hubHome }, 'hub', '--stop');
      expect(refused).toEqual({
        code: 1, stdout: '',
        stderr: `The hub's lock names process ${process.pid} on port ${other.port}, but no Worklings hub answers there as that process, so nothing was stopped.\n`,
      });
      expect(other.seen.map((s) => [s.method, s.path])).toEqual([['GET', '/api/health']]);
    } finally {
      await other.close();
    }
  });

  it("leaves the process alone when it stops answering as the hub before it would be ended", async () => {
    // A process that stays up; the lock names it.
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const alive = () => {
      try {
        process.kill(bystander.pid ?? 0, 0);
        return true;
      } catch {
        return false;
      }
    };
    let healthAsks = 0;
    const server = createHttpServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.url === '/api/health') {
          // Right at first it answers as the hub with the lock's process; the next time another program has the number.
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, app: 'worklings-hub', pid: healthAsks++ === 0 ? bystander.pid : (bystander.pid ?? 0) + 1 }));
        } else {
          // The hub doesn't take the stop, so the CLI is about to end it by its number.
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end('{}');
        }
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    try {
      const hubHome = writeTree(tempDir('worklings-home-'), { '.worklings/hub.lock': { pid: bystander.pid, port } });
      const result = await runWith({ ...env, WORKLINGS_HOME: hubHome }, 'hub', '--stop');
      expect(result).toEqual({ code: 1, stdout: expect.stringContaining('Stopping the Worklings hub'), stderr: `Process ${bystander.pid} no longer answers on port ${port} as the Worklings hub, so it was left running.
` });
      expect(alive()).toBe(true);
    } finally {
      bystander.kill();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('refuses what the hub never does: a folder, the local network, and --tailnet on an office', () => {
    expect(runStatus('hub', tempDir()).stderr).toContain('The hub takes no folder');
    expect(runStatus('hub', '--lan', '--port', '0', '--no-open').stderr).toBe('The hub never listens on the local network: use --tailnet to reach it from your phone.\n');
    expect(runStatus('hub', '--port', 'nope').stderr).toBe('--port must be a number between 0 and 65535, got nope\n');
    expect(runStatus('office', tempDir(), '--tailnet').stderr).toBe('--tailnet serves the hub: run `worklings hub --tailnet`.\n');
  });
});
