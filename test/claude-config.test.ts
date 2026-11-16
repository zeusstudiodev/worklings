// What a lean desk reads from the user's own Claude Code files (src/server/claude-config.ts): the catalogue the CEO
// assigns from (names and one line, never a secret), the configurations that go only into a desk's own file, and the deny
// rules and PreToolUse hooks carried over from the user's settings. Every file is the test's own, in a temporary folder
// standing for ~/.claude; the credentials file is there too, and nothing may open it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installedInWords, installedNames, readCarry, readInstalled, reservedName, serverConfigs, toolPrefixOf } from '../src/server/claude-config.ts';
import { tempDir } from './library-kit.ts';

/** Every file the module read, so a test can show it never touched the credentials. */
const reads = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>();
  return {
    ...real,
    readFileSync: ((...args: Parameters<typeof real.readFileSync>) => {
      reads.push(String(args[0]));
      return real.readFileSync(...args);
    }) as typeof real.readFileSync,
  };
});

const SECRET_TOKEN = 'sk-test-SECRET-0123456789';
const CREDENTIAL = 'CREDENTIAL-SENTINEL-must-never-be-read';

interface Kit {
  dir: string;
  env: NodeJS.ProcessEnv;
  write(path: string, value: unknown): void;
}

function kit(): Kit {
  const dir = tempDir('worklings-claude-config-');
  const write = (path: string, value: unknown) => {
    const file = join(dir, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('.credentials.json', { claudeAiOauth: { accessToken: CREDENTIAL } });
  return { dir, env: { CLAUDE_CONFIG_DIR: dir }, write };
}

/** A user with a server of their own, a plugin with two ways of declaring servers, and a plugin that is installed but off. */
function fullKit(): Kit {
  const k = kit();
  const plugins = join(k.dir, 'plugins', 'cache');
  k.write('.claude.json', {
    oauthAccount: { emailAddress: 'someone@example.com' },
    mcpServers: {
      github: { type: 'http', url: `https://api.example.test/mcp?key=${SECRET_TOKEN}`, headers: { Authorization: `Bearer ${SECRET_TOKEN}` } },
      notes: { command: 'node', args: ['notes-server.js', '--token', SECRET_TOKEN], env: { NOTES_TOKEN: SECRET_TOKEN } },
      org: { type: 'http', url: 'https://evil.example.test/mcp' },
      'bad name': { command: 'node' },
      weird: { type: 'carrier-pigeon', url: 'x' },
      noscheme: { type: 'http', url: 'ftp://example.test' },
    },
    projects: { [k.dir.split('\\').join('/')]: { mcpServers: { folderOnly: { command: 'node' } } } },
  });
  k.write('settings.json', {
    permissions: { deny: ['Read(//**/.env)', 'Bash(rm -rf:*)'] },
    enabledPlugins: { 'docs@market': true, 'maps@market': true, 'off@market': false, 'missing@market': true },
  });
  k.write('plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'docs@market': [{ scope: 'project', installPath: join(plugins, 'docs-project') }, { scope: 'user', installPath: join(plugins, 'docs') }],
      'maps@market': [{ scope: 'user', installPath: join(plugins, 'maps') }],
      'off@market': [{ scope: 'user', installPath: join(plugins, 'off') }],
    },
  });
  // docs: a flat .mcp.json and a manifest that names the same file; its description is the line the CEO reads.
  k.write('plugins/cache/docs/.mcp.json', { docs: { type: 'http', url: 'https://docs.example.test/mcp' } });
  k.write('plugins/cache/docs/.claude-plugin/plugin.json', { name: 'docs', description: 'Current library documentation for any package. Second sentence that is cut.', mcpServers: './.mcp.json' });
  k.write('plugins/cache/docs-project/.mcp.json', { shadow: { type: 'http', url: 'https://shadow.example.test/mcp' } });
  // maps: servers in the manifest itself, a plugin root in the command, and one that tries to read outside the plugin.
  k.write('plugins/cache/maps/.claude-plugin/plugin.json', {
    name: 'maps',
    mcpServers: { tiles: { command: '${CLAUDE_PLUGIN_ROOT}/bin/tiles', args: ['--data', '${CLAUDE_PLUGIN_ROOT}/data'] } },
  });
  k.write('plugins/cache/off/.mcp.json', { off: { type: 'http', url: 'https://off.example.test/mcp' } });
  return k;
}

beforeEach(() => {
  reads.length = 0;
});

describe('the catalogue', () => {
  it('lists the servers the user added and the ones in the plugins they enabled, by name and one line each', () => {
    const { servers } = readInstalled(fullKit().env);
    expect(servers.map((s) => [s.name, s.runs, s.source])).toEqual([
      ['github', 'remote', 'user'],
      ['notes', 'local', 'user'],
      ['plugin:docs:docs', 'remote', 'plugin'],
      ['plugin:maps:tiles', 'local', 'plugin'],
    ]);
    expect(servers.find((s) => s.name === 'plugin:docs:docs')?.description).toBe('Current library documentation for any package; from the docs plugin, runs over the web');
    expect(servers.find((s) => s.name === 'github')?.description).toBe('A server you added yourself (github), runs over the web');
    expect(servers.find((s) => s.name === 'plugin:maps:tiles')?.description).toBe('from the maps plugin, runs on this machine');
  });

  it('leaves out what it must not offer: the org name, odd shapes, a plugin that is off, the folder’s own and a project’s servers', () => {
    const k = fullKit();
    const names = [...installedNames(k.env)];
    for (const gone of ['org', 'bad name', 'weird', 'noscheme', 'folderOnly', 'off', 'plugin:off:off', 'shadow', 'plugin:docs:shadow']) expect(names).not.toContain(gone);
    expect(readInstalled(k.env).notes.filter((n) => n.startsWith('Skipped an MCP server')).length).toBe(4);
  });

  it('never carries a command, an address, a header or an environment value out of a config file', () => {
    const k = fullKit();
    const shown = JSON.stringify(readInstalled(k.env)) + installedInWords(readInstalled(k.env));
    for (const secret of [SECRET_TOKEN, 'api.example.test', 'notes-server.js', 'NOTES_TOKEN', 'Authorization', 'docs.example.test', CREDENTIAL, 'someone@example.com']) expect(shown).not.toContain(secret);
  });

  it('counts the user’s own skills and finds nothing when there are none', () => {
    const k = kit();
    expect(readInstalled(k.env)).toEqual({ servers: [], personalSkills: 0, notes: [] });
    k.write('skills/kickoff/SKILL.md', '# kickoff');
    k.write('skills/long-run/SKILL.md', '# long run');
    k.write('skills/not-a-skill/README.md', 'no');
    expect(readInstalled(k.env).personalSkills).toBe(2);
  });

  it('skips a file it can’t read, with a note that names the file and never its text', () => {
    const k = kit();
    k.write('.claude.json', '{"mcpServers": {"a": ' + SECRET_TOKEN);
    k.write('settings.json', '[1, 2]');
    const installed = readInstalled(k.env);
    expect(installed.servers).toEqual([]);
    expect(installed.notes).toEqual([`Skipped ${join(k.dir, '.claude.json')}: it couldn't be read as JSON.`, `Skipped ${join(k.dir, 'settings.json')}: it is not a JSON object.`]);
    expect(installed.notes.join()).not.toContain(SECRET_TOKEN);
  });

  it('puts the catalogue to the CEO in words: names and lines, what the defaults are, and what skills means', () => {
    const words = installedInWords(readInstalled(fullKit().env));
    expect(words).toContain('- plugin:docs:docs: Current library documentation for any package; from the docs plugin, runs over the web');
    expect(words).toContain('- github: A server you added yourself (github), runs over the web');
    expect(words).toContain('workers Read, Edit, Write, Bash, Glob, Grep; you and managers Read, Glob, Grep, Bash');
    expect(words).toContain("the user's personal skills are not loaded into desks");
    expect(installedInWords({ servers: [], personalSkills: 3, notes: [] })).toContain('the user has no MCP servers installed, so there is nothing to assign');
  });
});

describe('a plugin’s manifest', () => {
  it('may list its servers as a mix of files and maps, and can’t send the reader outside the plugin’s folder', () => {
    const k = kit();
    const root = join(k.dir, 'plugins', 'cache', 'mix');
    k.write('settings.json', { enabledPlugins: { 'mix@market': true } });
    k.write('plugins/installed_plugins.json', { plugins: { 'mix@market': [{ scope: 'user', installPath: root }] } });
    k.write('plugins/cache/mix/.claude-plugin/plugin.json', {
      name: 'mix',
      mcpServers: ['./extra.json', { inline: { type: 'sse', url: 'https://sse.example.test/mcp' } }, '../outside.json', join(k.dir, 'plugins', 'abs.json')],
    });
    k.write('plugins/cache/mix/extra.json', { mcpServers: { filed: { command: 'node', args: ['a.js'] } } });
    k.write('plugins/cache/outside.json', { escaped: { command: 'node' } });
    k.write('plugins/abs.json', { absolute: { command: 'node' } });
    expect([...installedNames(k.env)]).toEqual(['plugin:mix:filed', 'plugin:mix:inline']);
  });
});

describe('the configurations for a desk', () => {
  it('give the servers a person was assigned, with their secrets, keyed by the name the catalogue gives them', () => {
    const { servers, missing } = serverConfigs(['github', 'plugin:maps:tiles', 'plugin:docs:docs'], fullKit().env);
    expect(missing).toEqual([]);
    expect(Object.keys(servers)).toEqual(['github', 'plugin:maps:tiles', 'plugin:docs:docs']);
    expect(servers.github).toEqual({ type: 'http', url: `https://api.example.test/mcp?key=${SECRET_TOKEN}`, headers: { Authorization: `Bearer ${SECRET_TOKEN}` } });
    // A plugin's own folder fills ${CLAUDE_PLUGIN_ROOT}.
    const tiles = servers['plugin:maps:tiles'] as { command: string; args: string[] };
    expect(tiles.command.endsWith(`${join('plugins', 'cache', 'maps')}/bin/tiles`)).toBe(true);
    expect(tiles.args[1]?.endsWith('/data')).toBe(true);
    expect(JSON.stringify(servers)).not.toContain('${CLAUDE_PLUGIN_ROOT}');
  });

  it('name what was assigned and is not installed any more, and never hand over the org’s key', () => {
    const k = fullKit();
    expect(serverConfigs(['github', 'jira', 'org'], k.env)).toEqual({ servers: { github: expect.any(Object) }, missing: ['jira', 'org'] });
    expect(Object.keys(serverConfigs(['notes'], k.env).servers)).not.toContain('org');
    expect(toolPrefixOf('plugin:context7:context7')).toBe('mcp__plugin_context7_context7__');
    expect(toolPrefixOf('my.server')).toBe('mcp__my_server__');
  });

  it('keep two names that Claude Code spells alike in its tools apart, each under its own name', () => {
    const k = kit();
    k.write('.claude.json', { mcpServers: { 'a.b': { command: 'x' }, 'a:b': { command: 'y' } } });
    expect(serverConfigs(['a.b', 'a:b'], k.env).servers).toEqual({ 'a.b': { type: 'stdio', command: 'x' }, 'a:b': { type: 'stdio', command: 'y' } });
  });
});

describe('what a lean desk carries over from the user’s settings', () => {
  const guard = { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node', args: ['C:/Users/u/.claude/hooks/guard.mjs'], timeout: 10, onFailure: 'block' }] };

  it('brings their permissions, hooks on every event, sandbox, MCP lists and environment, each as written', () => {
    const k = kit();
    const everything = { matcher: '', hooks: [{ type: 'prompt', prompt: 'Is this safe?' }, { type: 'agent', prompt: 'Check it.' }, { type: 'http', url: 'http://localhost:1/h' }] };
    k.write('settings.json', {
      permissions: { deny: ['Read(//**/.env)', 'Read(~/.ssh/**)', 'Read(//**/.env)'], ask: ['Bash(git push:*)'], allow: ['Bash(git status)'], additionalDirectories: ['C:/shared'], disableBypassPermissionsMode: 'disable' },
      hooks: { PreToolUse: [guard, everything], PostToolUse: [{ hooks: [{ type: 'command', command: 'post' }] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'prompt' }] }], Stop: [{ hooks: [{ type: 'command', command: 'stop' }] }] },
      sandbox: { enabled: true, network: { allowedDomains: ['example.test'] } },
      env: { SOMETHING: 'x' },
      deniedMcpServers: [{ serverName: 'bad' }],
      allowedMcpServers: [{ serverName: 'good' }],
      disableBypassPermissionsMode: 'disable',
    });
    const carry = readCarry(k.env);
    expect(carry).toMatchObject({ complete: true, problem: null, notes: [] });
    expect(carry.deny).toEqual(['Read(//**/.env)', 'Read(~/.ssh/**)']);
    expect(carry.ask).toEqual(['Bash(git push:*)']);
    expect(carry.additionalDirectories).toEqual(['C:/shared']);
    expect(carry.disableBypassPermissionsMode).toBe('disable');
    // A group that matches everything ("") and every hook type stay as written.
    expect(carry.hooks.PreToolUse).toEqual([guard, everything]);
    expect(Object.keys(carry.hooks)).toEqual(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']);
    expect(carry.extra).toEqual({ env: { SOMETHING: 'x' }, sandbox: { enabled: true, network: { allowedDomains: ['example.test'] } }, deniedMcpServers: [{ serverName: 'bad' }], allowedMcpServers: [{ serverName: 'good' }], disableBypassPermissionsMode: 'disable' });
    // The user's allow rules are theirs, and not carried.
    expect(JSON.stringify(carry)).not.toContain('git status');
  });

  it('carries a long rule, a rule with a tab or a newline, hundreds of rules and dozens of groups, all of them', () => {
    const k = kit();
    const rules = ['Read(./' + 'a'.repeat(600) + ')', 'Bash(echo\tx)', 'Bash(echo\nx)', ...Array.from({ length: 800 }, (_, i) => `Read(./${i})`)];
    k.write('settings.json', { permissions: { deny: rules }, hooks: { PreToolUse: Array.from({ length: 50 }, (_, i) => ({ matcher: String(i), hooks: [{ type: 'command', command: 'x' }] })) } });
    const carry = readCarry(k.env);
    expect(carry.complete).toBe(true);
    expect(carry.deny).toEqual(rules);
    expect(carry.hooks.PreToolUse).toHaveLength(50);
  });

  it('keeps the user’s default model for a desk that names none, and only a well-formed one; their effort is never carried', () => {
    const k = kit();
    k.write('settings.json', { model: 'opus[1m]', effortLevel: 'high' });
    expect(readCarry(k.env)).toMatchObject({ model: 'opus[1m]', complete: true });
    expect(readCarry(k.env)).not.toHaveProperty('effort');
    k.write('settings.json', { model: '--dangerously-skip-permissions please', effortLevel: 'HIGH; rm' });
    expect(readCarry(k.env)).toMatchObject({ model: null });
  });

  it('names the user’s own CLAUDE.md for exclusion, with forward slashes, and none whose path holds a glob character', () => {
    const k = kit();
    expect(readCarry(k.env).excludeMemory).toEqual([`${k.dir.replaceAll('\\', '/')}/CLAUDE.md`]);
    expect(readCarry({ CLAUDE_CONFIG_DIR: `${k.dir}/odd*dir` }).excludeMemory).toEqual([]);
  });

  it('is empty and complete, without a note, when the user has no settings file', () => {
    expect(readCarry(kit().env)).toMatchObject({ hooks: {}, deny: [], ask: [], additionalDirectories: [], extra: {}, model: null, complete: true, problem: null, notes: [] });
  });

  describe('when it can’t carry everything it says so, and nothing is half carried', () => {
    const incomplete = (k: Kit, because: RegExp) => {
      const carry = readCarry(k.env);
      expect(carry.complete).toBe(false);
      expect(carry.problem).toMatch(because);
      return carry;
    };

    it('for a settings file that is not JSON, not an object, over 8 MB or not readable at all', () => {
      const k = kit();
      k.write('settings.json', '{"permissions": {"deny": [');
      incomplete(k, /^your Claude Code settings file couldn't be read as JSON, so the office can't tell what it protects$/);
      k.write('settings.json', '[1, 2]');
      incomplete(k, /is not a JSON object/);
      k.write('settings.json', JSON.stringify({ pad: 'x'.repeat(9 * 1024 * 1024) }));
      incomplete(k, /is bigger than 8 MB/);
      // A folder where the file should be: it exists, and it can't be read.
      const dir = tempDir('worklings-claude-config-');
      mkdirSync(join(dir, 'settings.json'));
      incomplete({ dir, env: { CLAUDE_CONFIG_DIR: dir }, write: k.write }, /^your Claude Code settings file/);
      // The carry is left empty rather than partly filled.
      expect(readCarry(k.env).deny).toEqual([]);
    });

    it('for permissions, hooks or events in a shape it doesn’t know, and for settings that turn all hooks off', () => {
      const k = kit();
      k.write('settings.json', { permissions: { deny: 'Read(x)' } });
      incomplete(k, /^your deny rules isn't a list$/);
      k.write('settings.json', { permissions: ['x'] });
      incomplete(k, /your permissions aren't a mapping/);
      k.write('settings.json', { hooks: [{ hooks: [] }] });
      incomplete(k, /your hooks aren't a mapping of events/);
      k.write('settings.json', { hooks: { PreToolUse: { hooks: [] } } });
      incomplete(k, /your PreToolUse hooks aren't a list/);
      k.write('settings.json', { disableAllHooks: true });
      incomplete(k, /turn all hooks off/);
      k.write('settings.json', { permissions: { deny: 1, ask: 2 }, hooks: 3 });
      expect(incomplete(k, /isn't a list/).problem).toMatch(/\(and 2 more\)$/);
    });
  });

  describe('plugin hooks', () => {
    const plugin = (k: Kit, hooks: unknown, manifest: object = { name: 'expo' }) => {
      const root = join(k.dir, 'plugins', 'cache', 'expo');
      k.write('settings.json', { enabledPlugins: { 'expo@market': true }, hooks: { PreToolUse: [guard] } });
      k.write('plugins/installed_plugins.json', { plugins: { 'expo@market': [{ scope: 'user', installPath: root }] } });
      k.write('plugins/cache/expo/.claude-plugin/plugin.json', manifest);
      if (hooks !== undefined) k.write('plugins/cache/expo/hooks/hooks.json', hooks);
      return root;
    };

    it('are carried after the user’s own, with the plugin’s folder filled in, except SessionStart which adds context', () => {
      const k = kit();
      const root = plugin(k, {
        hooks: {
          PostToolUse: [{ matcher: 'Skill', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/event.cjs" --plugin-root "${CLAUDE_PLUGIN_ROOT}"', timeout: 5 }] }],
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/guard' }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-start' }] }],
        },
      });
      const carry = readCarry(k.env);
      expect(carry.complete).toBe(true);
      expect(Object.keys(carry.hooks)).toEqual(['PreToolUse', 'PostToolUse']);
      expect(carry.hooks.PreToolUse).toEqual([guard, { matcher: '', hooks: [{ type: 'command', command: `${root}/guard` }] }]);
      expect(carry.hooks.PostToolUse).toEqual([{ matcher: 'Skill', hooks: [{ type: 'command', command: `node "${root}/scripts/event.cjs" --plugin-root "${root}"`, timeout: 5 }] }]);
      expect(JSON.stringify(carry.hooks)).not.toContain('CLAUDE_PLUGIN_ROOT');
      expect(carry.notes).toEqual(["Lean desks don't run the expo plugin's SessionStart hooks: they add context to a session, which a lean desk leaves out."]);
    });

    it('make the carry incomplete when a hook needs more of the plugin’s environment than its folder', () => {
      const k = kit();
      plugin(k, { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'node x.js "$CLAUDE_PLUGIN_DATA"' }] }] } });
      const carry = readCarry(k.env);
      expect(carry.complete).toBe(false);
      expect(carry.problem).toBe("the expo plugin's PostToolUse hook needs the plugin's own environment");
    });

    it('make it incomplete when a plugin’s hooks file can’t be read or isn’t in a shape the office knows', () => {
      const problem = (hooks: unknown, manifest?: object) => {
        const k = kit();
        plugin(k, hooks, manifest);
        const carry = readCarry(k.env);
        expect(carry.complete).toBe(false);
        return carry.problem;
      };
      expect(problem('{ not json')).toBe("the expo plugin's hooks file couldn't be read as JSON");
      expect(problem({ hooks: { PostToolUse: 'x' } })).toBe("the expo plugin's PostToolUse hooks aren't a list");
      expect(problem(undefined, { name: 'expo', hooks: 5 })).toBe("the expo plugin declares hooks in a form the office can't read");
      expect(problem(undefined, { name: 'expo', hooks: '../outside.json' })).toBe("the expo plugin's hooks file is outside the plugin");
      expect(problem(undefined, { name: 'expo', hooks: './missing.json' })).toBe("the expo plugin's hooks file isn't there");
    });

    it('also read hooks a manifest lists inline, and leave out a plugin that is off', () => {
      const k = kit();
      plugin(k, undefined, { name: 'expo', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bye' }] }] } });
      expect(readCarry(k.env).hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'bye' }] }]);
      k.write('settings.json', { enabledPlugins: { 'expo@market': false } });
      expect(readCarry(k.env).hooks).toEqual({});
    });
  });
});

describe('the catalogue and the user’s own lists', () => {
  it('leaves out a server the user denied or disabled, and keeps to their allow list when they have one', () => {
    const k = fullKit();
    k.write('settings.json', { ...JSON.parse(readFileSync(join(k.dir, 'settings.json'), 'utf8')), deniedMcpServers: [{ serverName: 'github' }, 'plugin:maps:tiles'] });
    expect([...installedNames(k.env)]).toEqual(['notes', 'plugin:docs:docs']);
    k.write('settings.json', { ...JSON.parse(readFileSync(join(k.dir, 'settings.json'), 'utf8')), deniedMcpServers: [], disabledMcpServers: ['notes'] });
    expect([...installedNames(k.env)]).toEqual(['github', 'plugin:docs:docs', 'plugin:maps:tiles']);
    k.write('settings.json', { ...JSON.parse(readFileSync(join(k.dir, 'settings.json'), 'utf8')), disabledMcpServers: [], allowedMcpServers: [{ serverName: 'notes' }, { serverName: 'docs' }] });
    // The allow list may name a plugin's server by its own key.
    expect([...installedNames(k.env)]).toEqual(['notes', 'plugin:docs:docs']);
    expect(Object.keys(serverConfigs(['github', 'notes'], k.env).servers)).toEqual(['notes']);
  });

  it('never offers a server whose tools would read like the org tools’', () => {
    const k = kit();
    const server = { command: 'node' };
    k.write('.claude.json', { mcpServers: { org: server, org_x: server, 'org.x': server, org__x: server, 'org-x': server, organic: server, myorg: server } });
    expect([...installedNames(k.env)]).toEqual(['org-x', 'organic', 'myorg']);
    expect(reservedName('org')).toBe(true);
    expect(reservedName('org_anything')).toBe(true);
    expect(reservedName('org:x')).toBe(true);
    expect(reservedName('organic')).toBe(false);
    expect(serverConfigs(['org_x', 'organic'], k.env)).toEqual({ servers: { organic: { type: 'stdio', command: 'node' } }, missing: ['org_x'] });
  });
});

describe('what it reads', () => {
  it('is only Claude Code’s settings JSON, the MCP servers file and the plugins’ own manifests: never the credentials', () => {
    const k = fullKit();
    readInstalled(k.env);
    readCarry(k.env);
    serverConfigs(['github', 'plugin:docs:docs'], k.env);
    expect(reads.length).toBeGreaterThan(0);
    expect(new Set(reads.map((r) => basename(r)))).toEqual(new Set(['.claude.json', 'settings.json', 'installed_plugins.json', '.mcp.json', 'plugin.json']));
    expect(reads.some((r) => r.includes('credentials'))).toBe(false);
  });
});
