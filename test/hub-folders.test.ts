import { execFileSync } from 'node:child_process';
import { installPacks } from '../src/packs/install.ts';
import { appendFileSync, chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { checkCompanyFolder, describeFolder, findGit, listFolder, makeFolder, type Places, shortFolder } from '../src/hub/folders.ts';
import { hookUrl } from '../src/server/hooks-config.ts';
import { miniLibrary, tempDir, writeTree } from './library-kit.ts';

const library = loadLibrary(miniLibrary());

const realGit = (() => {
  const git = findGit();
  if (!git) throw new Error('These tests need git on the PATH.');
  return git;
})();

/** An environment for git with none of this machine's own git config: an empty global file and no system one. */
function quietGit(): NodeJS.ProcessEnv {
  const config = join(tempDir('worklings-gitconfig-'), 'gitconfig');
  writeFileSync(config, '');
  return { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
}

/** A repository with one commit and its file changed since, made with the real git by its full path. */
function changedRepo(env: NodeJS.ProcessEnv): string {
  const repo = writeTree(tempDir('worklings-repo-'), { 'app.js': 'console.log(1)\n' });
  const git = (...args: string[]) => execFileSync(realGit, args, { cwd: repo, env, windowsHide: true, stdio: 'pipe' });
  git('init', '-q');
  git('add', 'app.js');
  git('-c', 'user.name=Grace Hopper', '-c', 'user.email=grace@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'One');
  writeFileSync(join(repo, 'app.js'), 'console.log(2)\n');
  return repo;
}

/** Marks programs leave when they run: what each noted, in a log outside the folder under test. */
function marks() {
  const dir = tempDir('worklings-marks-');
  const log = join(dir, 'ran.log');
  const note = join(dir, 'note.cjs');
  const preload = join(dir, 'preload.cjs');
  // A clean filter hands its input back; the rest ignore it.
  writeFileSync(note, "require('node:fs').appendFileSync(process.argv[2], `${process.argv[3]}\\n`);\nif (process.argv[3] === 'filter') process.stdin.pipe(process.stdout);\n");
  writeFileSync(preload, `require('node:fs').appendFileSync(${JSON.stringify(log)}, 'node\\n');\n`);
  const slash = (path: string) => path.replaceAll('\\', '/');
  return {
    /** A command for git's shell that notes `what` when it runs. */
    command: (what: string) => `"${slash(process.execPath)}" "${slash(note)}" "${slash(log)}" ${what}`,
    /** NODE_OPTIONS that make any Node program note "node" before it does anything else. */
    nodeOptions: `--require "${slash(preload)}"`,
    ran: (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
  };
}

/**
 * A git of the folder's own, as a downloaded folder can bring one: this Node under git's name, which notes each run
 * through NODE_OPTIONS. The environment puts "." first on the PATH, as some people's does, so a git started by its
 * name in the folder would be this one.
 */
function plantGit(folder: string, env: NodeJS.ProcessEnv) {
  const m = marks();
  const planted = join(folder, process.platform === 'win32' ? 'git.exe' : 'git');
  try {
    linkSync(process.execPath, planted);
  } catch {
    // Another drive or file system: a copy works as well.
    copyFileSync(process.execPath, planted);
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { env: { ...env, [pathKey]: `.${delimiter}${env[pathKey] ?? ''}`, NODE_OPTIONS: m.nodeOptions }, ran: m.ran };
}

const UNCOMMITTED = 'It has uncommitted changes; the company leaves them be.';

/**
 * Each git or Node start takes a second or more while other test runs load the machine, so the tests that start
 * several give each git command a long limit, and themselves one sized for the starts they make.
 */
const GIT = { gitTimeoutMs: 60_000 } as const;
const STARTS = (n: number) => ({ timeout: 30_000 + n * 10_000 });

/** A home folder, the hub's own folder and one company, all in temp folders. */
function places(): Places & { company: string } {
  const home = tempDir('worklings-home-');
  const company = join(tempDir('worklings-projects-'), 'plant-pal');
  mkdirSync(company);
  return { home, own: [join(home, '.worklings')], companies: [{ name: 'Plant Pal', root: company }], company };
}

const refusal = (raw: unknown, p: Places = places()) => {
  const check = checkCompanyFolder(raw, p);
  return check.ok ? null : { status: check.status, code: check.code, message: check.message };
};

describe('a folder for a new company', () => {
  it("refuses what isn't a full folder path, with the fix", () => {
    expect(refusal(undefined)?.message).toBe('Say which folder.');
    expect(refusal('  ')?.message).toBe('Say which folder.');
    expect(refusal('plant-pal')?.message).toMatch(/^Give the folder's full path, like /);
    expect(refusal(join(tempDir(), 'x'.repeat(261)))?.message).toBe('That path is longer than 260 characters. Pick a folder with a shorter path.');
    expect(refusal(join(tempDir(), 'a\u0007b'))?.message).toBe("That isn't a folder path.");
    expect(refusal('\\\\fileserver\\share\\plant-pal')?.message).toBe('Pick a folder on this computer: network and device paths are not supported.');
    expect(refusal('//fileserver/share')?.status).toBe(400);
  });

  it('takes an existing folder at its real path, or a new one whose parent exists', () => {
    const p = places();
    const existing = tempDir();
    expect(checkCompanyFolder(`${existing}  `, p)).toEqual({ ok: true, root: realpathSync.native(existing), exists: true });
    expect(checkCompanyFolder(join(existing, 'new-shop'), p)).toEqual({ ok: true, root: join(realpathSync.native(existing), 'new-shop'), exists: false });
    expect(refusal(join(existing, 'missing', 'new-shop'), p)).toMatchObject({ code: 'missing', message: "That folder doesn't exist, and neither does the folder it would go in. Make it with New folder here." });
    const file = writeTree(tempDir(), { 'notes.txt': 'hi' });
    expect(refusal(join(file, 'notes.txt'), p)?.message).toBe("That's a file, not a folder.");
  });

  it('refuses a link to a folder, so two companies can never share one', () => {
    const target = tempDir();
    const link = join(tempDir(), 'link');
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(refusal(link)?.message).toBe("That folder is a link. Pick the folder it points to: Worklings doesn't work through links.");
  });

  it("refuses the drive, the home folder and what holds it, system folders and Worklings' and Claude Code's own", () => {
    const p = places();
    expect(refusal(parse(p.home).root, p)?.message).toBe("That's a whole drive. Pick a folder in it.");
    expect(refusal(p.home, p)?.message).toBe("That's your home folder. Pick a folder in it.");
    expect(refusal(dirname(p.home), p)?.message).toBe('That folder holds your home folder. Pick one inside your home folder.');
    const system = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin';
    expect(refusal(system, p)?.message).toBe("That's a system folder. Pick one of your own.");
    mkdirSync(join(p.home, '.worklings', 'logs'), { recursive: true });
    expect(refusal(join(p.home, '.worklings', 'logs'), p)?.message).toBe('That folder is where Worklings or Claude Code keep their own files. Pick another.');
    expect(checkCompanyFolder(join(p.home, 'projects-dir'), p).ok).toBe(true);
  });

  it("refuses another company's folder, what is inside it and what is around it, by the company's name", () => {
    const p = places();
    expect(refusal(p.company, p)).toEqual({ status: 409, code: 'exists', message: 'Plant Pal already runs here. Open it from the lobby.' });
    expect(refusal(join(p.company, 'web'), p)).toEqual({ status: 409, code: 'inside', message: "That's inside Plant Pal's folder. Pick another." });
    expect(refusal(dirname(p.company), p)).toEqual({ status: 409, code: 'around', message: "Plant Pal's folder is inside that one. Pick another." });
  });
});

describe('the folder browser', () => {
  it('lists subfolders a level at a time: no files, links, hidden or system folders', async () => {
    const root = writeTree(tempDir(), {
      'src/': '', 'Docs/': '', 'app10/': '', 'app9/': '', '.git/': '', '.hidden/': '', '$Recycle.Bin/': '', 'node_modules/': '', 'README.md': '# hi',
    });
    symlinkSync(tempDir(), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const listing = await listFolder(root, { ...places(), library });
    if ('ok' in listing) throw new Error(listing.message);
    expect(listing.folders).toEqual(['app9', 'app10', 'Docs', 'src']);
    expect(listing.path).toBe(root);
    expect(listing.parent).toBe(dirname(root));
  });

  it("says what isn't a git repository means, for an empty folder and one with files", async () => {
    const empty = await listFolder(tempDir(), { ...places(), library });
    const full = await listFolder(writeTree(tempDir(), { 'index.html': '<p>hi</p>' }), { ...places(), library });
    expect('ok' in empty ? null : empty.notes).toEqual(['Not a git repository: starting runs git init so the work has its own branch.']);
    expect('ok' in full ? null : full.notes).toEqual(["Not a git repository, so finished tasks won't be committed until it is one."]);
    expect('ok' in empty ? null : empty.detected).toBe('An empty folder.');
  });

  it('notes uncommitted changes in the folder the person chose', STARTS(3), async () => {
    const repo = writeTree(tempDir(), { 'app.js': 'console.log(1)' });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const changed = await listFolder(repo, { ...places(), library, chosen: true, ...GIT });
    expect('ok' in changed ? null : changed.notes).toEqual([UNCOMMITTED]);
  });

  it('runs no git in a folder the browser only passes through', STARTS(3), async () => {
    const repo = changedRepo(quietGit());
    const planted = plantGit(repo, quietGit());
    const passing = await listFolder(repo, { ...places(), library, env: planted.env, ...GIT });
    expect('ok' in passing ? null : passing.notes).toEqual([]);
    expect(planted.ran()).toEqual([]);
  });

  it("runs the PATH's git for the chosen folder, never a git the folder brings", STARTS(5), async () => {
    const repo = changedRepo(quietGit());
    const planted = plantGit(repo, quietGit());
    const chosen = await listFolder(repo, { ...places(), library, env: planted.env, chosen: true, ...GIT });
    // The note comes from the real git: the planted one would note "node" and print nothing.
    expect('ok' in chosen ? null : chosen.notes).toEqual([UNCOMMITTED]);
    expect(planted.ran()).toEqual([]);
  });

  it("runs none of the chosen folder's own programs: its clean filter, fsmonitor or hooks", STARTS(5), async () => {
    const env = quietGit();
    const repo = changedRepo(env);
    const m = marks();
    // As git config writes a value: in quotes, with its quotes and backslashes escaped.
    const value = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const config = ['[filter "note"]', `\tclean = ${value(m.command('filter'))}`, '\trequired = true', '[core]', `\tfsmonitor = ${value(m.command('fsmonitor'))}`, '\thooksPath = .githooks', ''];
    appendFileSync(join(repo, '.git', 'config'), config.join('\n'));
    writeTree(repo, { '.gitattributes': '* filter=note\n', '.githooks/post-index-change': `#!/bin/sh\n${m.command('hook')}\n` });
    chmodSync(join(repo, '.githooks', 'post-index-change'), 0o755);
    const chosen = await listFolder(repo, { ...places(), library, env, chosen: true, ...GIT });
    expect('ok' in chosen ? null : chosen.notes).toEqual([UNCOMMITTED]);
    expect(m.ran()).toEqual([]);
  });

  it('finds git in the PATH’s absolute folders only, so a folder can’t supply its own', () => {
    const files = (...paths: string[]) => (file: string) => paths.includes(file);
    const exe = 'C:\\Program Files\\Git\\cmd\\git.exe';
    expect(findGit({ Path: `.;node_modules\\.bin;;"C:\\Program Files\\Git\\cmd"` }, 'win32', files('git.exe', 'node_modules\\.bin\\git.exe', exe))).toBe(exe);
    expect(findGit({ PATH: '.:bin:/usr/bin' }, 'linux', files('git', 'bin/git', '/usr/bin/git'))).toBe('/usr/bin/git');
    expect(findGit({ PATH: '.' }, 'linux', files('git'))).toBeNull();
  });

  it('notes a company here or around', async () => {
    const p = places();
    const here = await listFolder(p.company, { ...p, library });
    expect('ok' in here ? null : here.notes[0]).toBe('Plant Pal already runs here.');
    mkdirSync(join(p.company, 'web'));
    const inside = await listFolder(join(p.company, 'web'), { ...p, library });
    expect('ok' in inside ? null : inside.notes[0]).toBe("That's inside Plant Pal's folder.");
    const before = writeTree(tempDir(), { '.worklings/events.jsonl': '' });
    const reopened = await listFolder(before, { ...p, library });
    expect('ok' in reopened ? null : reopened.notes[0]).toBe('A company worked here before: starting reopens it.');
  });

  it('says what detection found in a sentence', () => {
    const app = writeTree(tempDir(), { 'package.json': { dependencies: { expo: '~55.0.0', react: '19.3.1' } }, 'app.json': {} });
    expect(describeFolder(app, library)).toBe('A mini app with Expo and React.');
    expect(describeFolder(writeTree(tempDir(), { 'notes.txt': 'hi' }), library)).toBe('No code here yet.');
    expect(describeFolder(writeTree(tempDir(), { 'tool.rb': 'puts 1' }), library)).toBe('A folder with files, but no stack Worklings recognises.');
  });

  it("refuses a folder that isn't there", async () => {
    expect(await listFolder(join(tempDir(), 'gone'), { ...places(), library })).toMatchObject({ ok: false, status: 404, message: "That folder doesn't exist." });
  });
});

describe("what a folder brings for Claude Code, which every person's session would use", () => {
  const notesFor = async (files: Record<string, string | object>) => {
    const listing = await listFolder(writeTree(tempDir(), { 'index.html': '<p>hi</p>', ...files }), { ...places(), library });
    if ('ok' in listing) throw new Error(listing.message);
    // The first note says it isn't a git repository.
    return listing.notes.slice(1);
  };
  const officeHook = { type: 'http', url: hookUrl(7421), timeout: 2 };
  const HOOKS = (files: string) => `It brings its own Claude Code hooks (in ${files}), which can run in every person's session.`;
  const RULES = (files: string) => `It brings its own Claude Code permission rules (in ${files}), which let every person's session use some tools without asking.`;
  const KEY_HELPER = (files: string) => `It sets its own apiKeyHelper (in ${files}): every person's session runs that command and signs in with the key it prints, instead of this computer's Claude Code login.`;
  const HELPERS = (keys: string, files: string) => `It brings its own Claude Code helper commands (${keys}, in ${files}), which can run in every person's session without asking.`;
  const ENV = (files: string) => `It sets environment variables for Claude Code (in ${files}), which reach every person's session and the commands it runs.`;
  const PLUGINS = (files: string) => `It turns on Claude Code plugins (in ${files}), whose hooks, MCP servers and agents run in every person's session if this computer has them installed.`;
  const MCP = "It brings its own MCP servers (in .mcp.json). Desks leave them out (each person loads only the MCP servers they were assigned), unless this Claude Code can't start a desk that way: then every person's session would load them.";

  it("names the hooks it brings, but not the office's own", async () => {
    const own = { hooks: { Stop: [{ hooks: [officeHook] }], PreToolUse: [{ matcher: '*', hooks: [{ ...officeHook, url: 'http://127.0.0.1:7421/hooks?from=headcount' }] }] } };
    expect(await notesFor({ '.claude/settings.local.json': own })).toEqual([]);
    const theirs = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }], Stop: [{ hooks: [officeHook] }] } };
    expect(await notesFor({ '.claude/settings.json': theirs })).toEqual([HOOKS('.claude/settings.json')]);
    const lookalike = { hooks: { Stop: [{ hooks: [{ ...officeHook, url: 'http://127.0.0.1:7421/hooks?from=worklings-bot' }] }] } };
    expect(await notesFor({ '.claude/settings.json': theirs, '.claude/settings.local.json': lookalike })).toEqual([HOOKS('.claude/settings.json and .claude/settings.local.json')]);
  });

  it('says which packs the folder has, for the start form (v0.9)', async () => {
    const root = writeTree(tempDir(), { 'index.html': '<p>hi</p>' });
    installPacks(root, ['kickoff']);
    const listing = await listFolder(root, { ...places(), library });
    if ('ok' in listing) throw new Error(listing.message);
    expect(listing.notes.slice(1)).toEqual([]);
    expect(listing.packs.packs.kickoff.state).toBe('installed');
    expect(listing.packs.blocked).toBeNull();
  });

  it('names permission rules that let a session use tools without asking', async () => {
    expect(await notesFor({ '.claude/settings.json': { permissions: { allow: ['Bash(npm test)'] } } })).toEqual([RULES('.claude/settings.json')]);
    expect(await notesFor({ '.claude/settings.json': { permissions: { allow: [], deny: ['Bash(rm:*)'], ask: ['Bash(git push:*)'] } } })).toEqual([]);
  });

  // Claude Code ignores bypassPermissions and auto from a project's files since 2.1.257, and a desk's --permission-mode
  // outranks the file's mode in any case, so a mode alone lets nobody skip a question.
  it('says nothing of a default permission mode the project sets, which no desk takes', async () => {
    for (const defaultMode of ['bypassPermissions', 'auto', 'acceptEdits']) {
      expect(await notesFor({ '.claude/settings.local.json': { permissions: { defaultMode } } })).toEqual([]);
    }
    expect(await notesFor({ '.claude/settings.json': { permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(npm test)'] } } })).toEqual([RULES('.claude/settings.json')]);
  });

  it('names the MCP servers in .mcp.json, which a lean desk leaves out', async () => {
    const servers = { mcpServers: { deploy: { command: 'node', args: ['tools/deploy-mcp.js'] } } };
    expect(await notesFor({ '.mcp.json': servers })).toEqual([MCP]);
    expect(await notesFor({ '.mcp.json': { mcpServers: {} } })).toEqual([]);
  });

  it('says when its settings name an apiKeyHelper, which every session would sign in with', async () => {
    expect(await notesFor({ '.claude/settings.json': { apiKeyHelper: 'node scripts/print-key.js' } })).toEqual([KEY_HELPER('.claude/settings.json')]);
    expect(await notesFor({ '.claude/settings.json': { apiKeyHelper: 42 }, '.claude/settings.local.json': { apiKeyHelper: '   ' } })).toEqual([]);
  });

  it('names the helper commands Claude Code runs by itself', async () => {
    const shared = { awsCredentialExport: 'aws configure export-credentials --format process', otelHeadersHelper: 'scripts/otel-headers.sh' };
    const local = { awsAuthRefresh: 'aws sso login', gcpAuthRefresh: '' };
    expect(await notesFor({ '.claude/settings.json': shared, '.claude/settings.local.json': local })).toEqual([
      HELPERS('awsAuthRefresh, awsCredentialExport and otelHeadersHelper', '.claude/settings.json and .claude/settings.local.json'),
    ]);
  });

  it('says when its settings set environment variables for every session', async () => {
    expect(await notesFor({ '.claude/settings.local.json': { env: { ANTHROPIC_BASE_URL: 'https://llm.example.com' } } })).toEqual([ENV('.claude/settings.local.json')]);
    expect(await notesFor({ '.claude/settings.json': { env: {} }, '.claude/settings.local.json': { env: 'PATH=bin' } })).toEqual([]);
  });

  it('says when its settings turn plugins on, and not when they only turn them off', async () => {
    expect(await notesFor({ '.claude/settings.json': { enabledPlugins: { 'deploy-tools@acme': true, 'old-linter@acme': false } } })).toEqual([PLUGINS('.claude/settings.json')]);
    expect(await notesFor({ '.claude/settings.json': { enabledPlugins: { 'old-linter@acme': false } } })).toEqual([]);
  });

  it('leaves out what changes nothing in a desk: a status line, @ file suggestions and MCP server approvals', async () => {
    const settings = {
      statusLine: { type: 'command', command: 'node .claude/status.js' },
      fileSuggestion: { type: 'command', command: 'node .claude/files.js' },
      enableAllProjectMcpServers: true,
      enabledMcpjsonServers: ['deploy'],
    };
    expect(await notesFor({ '.claude/settings.json': settings })).toEqual([]);
    expect(await notesFor({ '.claude/settings.json': settings, '.mcp.json': { mcpServers: { deploy: { command: 'node', args: ['deploy.js'] } } } })).toEqual([MCP]);
  });

  it('says each thing its settings bring in one sentence, in a steady order', async () => {
    const settings = {
      env: { NODE_OPTIONS: '--require ./preload.js' },
      enabledPlugins: { 'deploy-tools@acme': true },
      apiKeyHelper: 'node scripts/print-key.js',
      otelHeadersHelper: 'scripts/otel-headers.sh',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/start.js' }] }] },
    };
    expect(await notesFor({ '.claude/settings.json': settings })).toEqual([
      HOOKS('.claude/settings.json'),
      KEY_HELPER('.claude/settings.json'),
      HELPERS('otelHeadersHelper', '.claude/settings.json'),
      ENV('.claude/settings.json'),
      PLUGINS('.claude/settings.json'),
    ]);
  });

  it('counts the agents Worklings didn’t write, by the roles studio.yaml lists', async () => {
    const agent = (name: string) => `---\nname: ${name}\ndescription: Does ${name} work.\n---\nBody.\n`;
    const agents = { '.claude/agents/ux-designer.md': agent('ux-designer'), '.claude/agents/team/frontend.md': agent('Frontend Developer'), '.claude/agents/deploy-bot.md': agent('deploy-bot') };
    const studio = ['version: 1', 'name: Plant Pal', 'departments:', '  - id: design', 'roles:', '  - id: ux-designer', '    department: design', '  - id: frontend-developer', '    department: design', '    agent: Frontend Developer', ''].join('\n');
    expect(await notesFor({ ...agents, '.claude/studio.yaml': studio })).toEqual(["It brings a Claude Code agent Worklings didn't write (in .claude/agents), which every person's session can hand work to."]);
    expect(await notesFor(agents)).toEqual(["It brings 3 Claude Code agents Worklings didn't write (in .claude/agents), which every person's session can hand work to."]);
    expect(await notesFor({ '.claude/agents/ux-designer.md': agent('ux-designer'), '.claude/studio.yaml': studio })).toEqual([]);
  });

  it("reads each file only up to a size, and says when it couldn't check one", async () => {
    const huge = `{"permissions": {"allow": []}, "padding": "${'x'.repeat(1024 * 1024)}"}`;
    expect(await notesFor({ '.claude/settings.json': huge, '.claude/settings.local.json': '{"hooks": ' })).toEqual([
      "It brings Claude Code settings Worklings couldn't check (in .claude/settings.json and .claude/settings.local.json), which can run hooks and other commands in every person's session.",
    ]);
    expect(await notesFor({ '.mcp.json': `{"mcpServers": {}, "padding": "${'x'.repeat(1024 * 1024)}"}` })).toEqual([
      "It brings an .mcp.json Worklings couldn't check. Desks leave them out (each person loads only the MCP servers they were assigned), unless this Claude Code can't start a desk that way: then every person's session would load them.",
    ]);
    const studio = 'version: 1\nname: Plant Pal\ndepartments:\n  - id: design\nroles:\n  - id: ux-designer\n    department: design\n';
    const big = `---\nname: ux-designer\n---\n${'x'.repeat(256 * 1024)}`;
    expect(await notesFor({ '.claude/agents/ux-designer.md': big, '.claude/studio.yaml': studio })).toEqual([
      "It brings a Claude Code agent Worklings didn't write (in .claude/agents), which every person's session can hand work to.",
    ]);
  });
});

describe('a folder in a sentence', () => {
  it('cuts a long path to its start and the folder’s own name, as the lobby does', () => {
    expect(shortFolder('C:\\Users\\jamie\\Desktop\\Development\\clients\\plant-pal')).toBe('C:\\Users\\…\\plant-pal');
    expect(shortFolder('/home/jamie/projects/clients/2026/plant-pal')).toBe('/home/…/plant-pal');
    expect(shortFolder('C:\\Users\\you\\plant-pal')).toBe('C:\\Users\\you\\plant-pal');
    // A folder whose own name is too long keeps its end.
    expect(shortFolder(`C:\\Users\\jamie\\Desktop\\${'a-very-long-folder-name-'.repeat(3)}end`)).toBe('C:\\Users\\…me-a-very-long-folder-name-end');
  });
});

describe('New folder here', () => {
  it('makes one folder, never over one that exists', () => {
    const parent = tempDir();
    expect(makeFolder(parent, ' plant-pal ', places())).toEqual({ ok: true, path: join(parent, 'plant-pal') });
    expect(existsSync(join(parent, 'plant-pal'))).toBe(true);
    expect(makeFolder(parent, 'plant-pal', places())).toMatchObject({ ok: false, status: 409, message: 'That folder already exists.' });
    expect(makeFolder(join(parent, 'gone'), 'x', places())).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses names a folder can't have", () => {
    const parent = tempDir();
    for (const name of ['', 'a/b', 'a\\b', 'what?', 'con', 'LPT1.txt', 'dots.', '..', `tab\tname`, 'x'.repeat(101)]) {
      expect(makeFolder(parent, name, places()).ok).toBe(false);
    }
  });
});
