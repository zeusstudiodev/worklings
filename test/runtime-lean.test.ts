// Lean desks (v0.2): what a desk is started with, from the command line to the files in its temporary folder, and what
// the harness does when the desk says it loaded something it wasn't given or when Claude Code doesn't take the flags.
// The first half builds the arguments and the files as plain functions; the second runs desks on the fake Claude Code
// (test/fake-desk.mjs) in a world whose ~/.claude is a temporary folder of the test's own.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLoads, resolveLoads } from '../src/core/loads.ts';
import type { Carry } from '../src/server/claude-config.ts';
import { deskArgs, deskMcpConfig, deskSettings, forgetNotes, HarnessError, type HarnessPlan, leanTools } from '../src/runtime/harness.ts';
import { forStarts, isDesk, isNotice, isTurn, until, world, type World } from './runtime-kit.ts';

const SECRET = 'sk-test-SECRET-0123456789';

const plan = (extra: Partial<HarnessPlan> = {}): HarnessPlan => ({
  person: 'ada', cwd: '.', sessionId: '4f2a8f5e-1111-4222-8333-444455556666', resume: false, model: 'haiku', effort: null, agent: null, systemPrompt: 'Be kind.',
  hubUrl: 'http://127.0.0.1:7431', allow: ['mcp__org'], ask: [], deny: ['Read(./.worklings/**)'], issueToken: () => 'token', ...extra,
});
const files = { settings: '/tmp/s.json', mcp: '/tmp/m.json' };
const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('the arguments of a lean desk', () => {
  it('are today’s, with nothing added, when the plan names no loads', () => {
    const args = deskArgs(plan(), files);
    for (const flag of ['--setting-sources', '--strict-mcp-config', '--tools']) expect(args).not.toContain(flag);
  });

  it('add the project’s and local settings only, the strict MCP config and the tools the person has', () => {
    const args = deskArgs(plan({ loads: defaultLoads('worker') }), files);
    expect(flagValue(args, '--setting-sources')).toBe('project,local');
    expect(args).toContain('--strict-mcp-config');
    expect(flagValue(args, '--tools')).toBe('Read,Edit,Write,Bash,Glob,Grep');
    // --tools never comes without --strict-mcp-config: that would load every MCP tool of the user's upfront.
    expect(args.indexOf('--strict-mcp-config')).toBeLessThan(args.indexOf('--tools'));
    expect(deskArgs(plan({ loads: defaultLoads('ceo') }), files).join(' ')).toContain('--tools Read,Bash,Glob,Grep');
  });

  it('add the Skill tool for skills and ToolSearch for servers, and an empty list for a desk with only the org tools', () => {
    expect(leanTools(resolveLoads({ skills: true }, 'worker'))).toEqual(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Skill']);
    expect(leanTools(resolveLoads({ mcp: ['github'], skills: true, tools: ['Read'] }, 'worker'))).toEqual(['Read', 'Skill', 'ToolSearch']);
    const none = deskArgs(plan({ loads: resolveLoads({ tools: [] }, 'worker') }), files);
    expect(flagValue(none, '--tools')).toBe('');
  });

  it('can be switched off by the harness for one start, which gives today’s arguments back', () => {
    const args = deskArgs(plan({ loads: defaultLoads('worker') }), files, { lean: false });
    expect(args).not.toContain('--tools');
    expect(args).toEqual(deskArgs(plan(), files));
  });

  it('refuse a value that Claude Code would read as a flag', () => {
    expect(() => deskArgs(plan({ loads: { tools: ['-p'], skills: false, mcp: [] } }), files)).toThrow(HarnessError);
  });
});

describe('the files of a lean desk', () => {
  const guard = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['guard.mjs'] }] };
  const carryOf = (over: Partial<Carry> = {}): Carry => ({
    hooks: {}, deny: [], ask: [], additionalDirectories: [], disableBypassPermissionsMode: undefined, extra: {}, model: null, complete: true, problem: null, notes: [], excludeMemory: [], ...over,
  });
  const carry = carryOf({ deny: ['Read(//**/.env)', 'Read(./.worklings/**)'], hooks: { PreToolUse: [guard] }, model: 'opus' });

  it('keep the user’s deny rules beside the office’s, once each, so a rule that blocked before still blocks', () => {
    const settings = deskSettings(plan(), carry) as { permissions: { deny: string[] } };
    expect(settings.permissions.deny).toEqual(['Read(./.worklings/**)', 'Read(//**/.env)']);
    expect(deskSettings(plan(), null)).toEqual(deskSettings(plan()));
  });

  it('leave the user’s own CLAUDE.md out by name, so a project under their home folder does not find it as an ancestor’s file', () => {
    const settings = deskSettings(plan(), carryOf({ excludeMemory: ['C:/Users/a/.claude/CLAUDE.md'] })) as { claudeMdExcludes?: string[] };
    expect(settings.claudeMdExcludes).toEqual(['C:/Users/a/.claude/CLAUDE.md']);
    expect(deskSettings(plan(), null)).not.toHaveProperty('claudeMdExcludes');
  });

  it('keep the user’s ask rules, extra directories, sandbox, MCP lists and environment, as written', () => {
    const settings = deskSettings(
      plan({ ask: ['Edit(./.claude/**)'] }),
      carryOf({
        ask: ['Bash(git push:*)', 'Edit(./.claude/**)'], additionalDirectories: ['C:/shared'], disableBypassPermissionsMode: 'disable',
        extra: { sandbox: { enabled: true }, env: { A: 'b' }, deniedMcpServers: [{ serverName: 'x' }], allowedMcpServers: [{ serverName: 'y' }] },
      }),
    ) as { permissions: Record<string, unknown> } & Record<string, unknown>;
    expect(settings.permissions).toEqual({
      allow: ['mcp__org'], ask: ['Edit(./.claude/**)', 'Bash(git push:*)'], deny: ['Read(./.worklings/**)'], additionalDirectories: ['C:/shared'], disableBypassPermissionsMode: 'disable',
    });
    expect(settings).toMatchObject({ sandbox: { enabled: true }, env: { A: 'b' }, deniedMcpServers: [{ serverName: 'x' }], allowedMcpServers: [{ serverName: 'y' }] });
  });

  it('run the user’s hooks, on every event, before the office’s own, which stay as they were', () => {
    const post = { hooks: [{ type: 'command', command: 'post' }] };
    const stop = { hooks: [{ type: 'command', command: 'stop' }] };
    const { hooks } = deskSettings(plan(), carryOf({ hooks: { PreToolUse: [guard], PostToolUse: [post], Stop: [stop] } })) as { hooks: Record<string, unknown[]> };
    expect(Object.keys(hooks)).toEqual(['PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest', 'SubagentStop']);
    expect(hooks.PreToolUse).toEqual([guard]);
    expect(hooks.PostToolUse).toEqual([post]);
    // Stop: the user's, then the office's liveness hook.
    expect(hooks.Stop).toHaveLength(2);
    expect(hooks.Stop?.[0]).toEqual(stop);
    expect(Object.keys((deskSettings(plan()) as { hooks: object }).hooks)).toEqual(['PermissionRequest', 'Stop', 'SubagentStop']);
  });

  it('give a person on the user’s own default model that model, and one with a model of their own theirs', () => {
    expect(deskSettings(plan({ model: null }), carry)).toMatchObject({ model: 'opus' });
    expect(deskSettings(plan({ model: 'haiku', effort: 'low' }), carry)).not.toHaveProperty('model');
    // Effort is never taken from the user's settings: the desk's --effort is the company's (or the default).
    expect(deskSettings(plan({ model: null }), carry)).not.toHaveProperty('effortLevel');
  });

  it('add the assigned servers to the MCP config, and the org’s server last, so nothing can take its place', () => {
    const config = deskMcpConfig(plan(), { github: { type: 'http', url: 'https://x.test' }, org: { type: 'http', url: 'https://evil.test' } }) as { mcpServers: Record<string, { url: string }> };
    expect(Object.keys(config.mcpServers)).toEqual(['github', 'org']);
    expect(config.mcpServers.org?.url).toBe('http://127.0.0.1:7431/mcp');
  });
});

// ---------------------------------------------------------------------------------------------------------------------

let open: World | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
  vi.restoreAllMocks();
  forgetNotes();
});

async function lean(script: object = {}, o: Parameters<typeof world>[1] = {}): Promise<World> {
  forgetNotes();
  open = await world(script, o);
  return open;
}

/** Gives the test's ~/.claude a server with a secret in its configuration, and a settings file with guards. */
function userSetup(w: World): void {
  writeFileSync(join(w.configDir, '.claude.json'), JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://api.example.test/mcp', headers: { Authorization: `Bearer ${SECRET}` } } } }));
  writeFileSync(
    join(w.configDir, 'settings.json'),
    JSON.stringify({ permissions: { deny: ['Read(//**/.env)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['guard.mjs'] }] }] }, model: 'opus' }),
  );
}

describe('a lean desk, started', () => {
  it('opens every desk lean by default: the project’s settings, no MCP but the org’s, six tools for a worker and four for a manager', async () => {
    const w = await lean();
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    w.board.deliver(w.plan('ceo', { person: { id: 'ceo', name: 'Noor', title: 'CEO', level: 'ceo', room: 'ceo-office', reportsTo: null, look: {} } }), { text: 'Plan it.', messageId: 'm-2' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(2) });
    await w.rec.waitFor(isTurn('ceo'), { ms: forStarts(2) });
    const starts = w.starts();
    expect(starts).toHaveLength(2);
    const byTools = starts.map((s) => flagValue(s.argv ?? [], '--tools')).sort();
    expect(byTools).toEqual(['Read,Bash,Glob,Grep', 'Read,Edit,Write,Bash,Glob,Grep']);
    for (const s of starts) {
      expect(flagValue(s.argv ?? [], '--setting-sources')).toBe('project,local');
      expect(s.argv).toContain('--strict-mcp-config');
      expect(s.claudeaiMcp).toBe('false');
    }
    // The desk reports what it has: its tools and the org tools, and one MCP server, the org's.
    const init = w.log().find((e) => e.event === 'init');
    expect((init?.tools as string[]).filter((t) => !t.startsWith('mcp__'))).toEqual(expect.arrayContaining(['Read']));
    expect(init?.mcpServers).toEqual(['org']);
  });

  it('gives a person the servers and skills they were assigned, and their secrets go only into the desk’s own MCP file', async () => {
    const w = await lean();
    userSetup(w);
    w.board.deliver(w.plan('ada', { loads: { tools: ['Read', 'Grep'], skills: true, mcp: ['github'] } }), { text: 'Look it up.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    const [start] = w.starts();
    expect(flagValue(start?.argv ?? [], '--tools')).toBe('Read,Grep,Skill,ToolSearch');
    const mcp = JSON.parse(start?.mcpConfig ?? '{}') as { mcpServers: Record<string, { headers?: Record<string, string> }> };
    expect(Object.keys(mcp.mcpServers)).toEqual(['github', 'org']);
    expect(mcp.mcpServers.github?.headers?.Authorization).toBe(`Bearer ${SECRET}`);
    // Not on the command line, not in the settings file, not in the environment record, not anywhere the office could log it.
    expect(JSON.stringify(start?.argv)).not.toContain(SECRET);
    expect(start?.settings).not.toContain(SECRET);
    expect(JSON.stringify(start?.env)).not.toContain(SECRET);
    const init = w.log().find((e) => e.event === 'init');
    expect(init?.mcpServers).toEqual(['github', 'org']);
    expect(init?.tools).toContain('mcp__github__ping');
  });

  it('carries the user’s deny rules and guards into the desk’s settings, beside the office’s hooks', async () => {
    const w = await lean();
    userSetup(w);
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    const settings = JSON.parse(w.starts()[0]?.settings ?? '{}') as { permissions: { deny: string[] }; hooks: Record<string, unknown[]>; model?: string };
    expect(settings.permissions.deny).toContain('Read(//**/.env)');
    expect(settings.permissions.deny).toContain('Read(./.worklings/**)');
    expect(Object.keys(settings.hooks)).toEqual(['PreToolUse', 'PermissionRequest', 'Stop', 'SubagentStop']);
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['guard.mjs'] }] }]);
    // The plan names a model, so the user's default stays out.
    expect(settings.model).toBeUndefined();
  });

  it('gives a person on the user’s default model that model, since the desk no longer reads the user’s settings', async () => {
    const w = await lean();
    userSetup(w);
    w.board.deliver(w.plan('ada', { model: 'inherit' }), { text: 'Build it.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    const [start] = w.starts();
    expect(start?.argv).not.toContain('--model');
    expect(JSON.parse(start?.settings ?? '{}')).toMatchObject({ model: 'opus' });
  });

  it('starts without a server that was assigned and is gone, and says so once', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const w = await lean();
    w.board.deliver(w.plan('ada', { loads: { tools: ['Read'], skills: false, mcp: ['gone'] } }), { text: 'One.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    expect(Object.keys(JSON.parse(w.starts()[0]?.mcpConfig ?? '{}').mcpServers)).toEqual(['org']);
    const notes = written.filter((l) => l.includes('"gone"'));
    expect(notes).toEqual([`worklings: ada's desk was assigned the MCP server "gone", which isn't installed any more: it starts without it.\n`]);
  });

  it('reopens a desk whose assignment changed, so the new one is what it has', async () => {
    const w = await lean();
    w.board.deliver(w.plan('ada'), { text: 'One.', messageId: 'm-1' });
    const first = await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    await w.rec.waitFor(isDesk('ada', 'idle'), { ms: forStarts(1) });
    w.board.deliver(w.plan('ada', { loads: { skills: true } }), { text: 'Two.', messageId: 'm-2' });
    await w.rec.waitFor(isTurn('ada'), { from: w.rec.heard.indexOf(first) + 1, ms: forStarts(2) });
    expect(w.starts().map((s) => flagValue(s.argv ?? [], '--tools'))).toEqual(['Read,Edit,Write,Bash,Glob,Grep', 'Read,Edit,Write,Bash,Glob,Grep,Skill']);
  });
});

describe('a lean desk that comes up wrong', () => {
  it('is refused, with a sentence, when it loaded MCP tools nobody assigned, and nothing is left running', async () => {
    const w = await lean({ leakMcp: ['gmail'] });
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    const refused = await w.rec.waitFor((e): e is Extract<typeof e, { kind: 'desk' }> => e.kind === 'desk' && e.view.person === 'ada' && (e.view.problem ?? '').includes('MCP tools nobody assigned'), { ms: forStarts(3) });
    expect(refused.view.problem).toBe(
      "ada's desk came up with MCP tools nobody assigned (gmail), which would load them into every request, so it was stopped. This Claude Code may not honour --strict-mcp-config: update it, then try again.",
    );
    // It never took a turn: nothing it said after init reached the company.
    expect(w.rec.heard.some(isTurn('ada'))).toBe(false);
    // world.close() waits for every process the fake started to be gone.
  });

  it('is not refused for the servers it was given, and the org’s are always allowed', async () => {
    const w = await lean();
    userSetup(w);
    w.board.deliver(w.plan('ada', { loads: { tools: ['Read'], skills: false, mcp: ['github'] } }), { text: 'Go.', messageId: 'm-1' });
    const turn = await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    expect(turn.result.ok).toBe(true);
  });

  it('falls back to today’s arguments when Claude Code doesn’t take the flags, says so once, and the turn still gets done', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const w = await lean({ rejectFlags: true });
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    const turn = await w.rec.waitFor(isTurn('ada'), { ms: forStarts(3) });
    expect(turn.result.ok).toBe(true);
    const starts = w.starts();
    expect(starts).toHaveLength(2);
    expect(starts[0]?.argv).toContain('--strict-mcp-config');
    expect(starts[1]?.argv).not.toContain('--strict-mcp-config');
    expect(starts[1]?.argv).not.toContain('--tools');
    expect(starts[1]?.argv).not.toContain('--setting-sources');
    expect(starts[1]?.claudeaiMcp).toBeNull();
    // Every desk after that starts the old way too, without trying the flags again.
    w.board.deliver(w.plan('bo'), { text: 'And you.', messageId: 'm-2' });
    await w.rec.waitFor(isTurn('bo'), { ms: forStarts(2) });
    expect(w.starts()).toHaveLength(3);
    expect(w.starts()[2]?.argv).not.toContain('--tools');
    expect(written.filter((l) => l.includes('flags that make a desk lean'))).toHaveLength(1);
    expect(w.rec.heard.filter(isNotice).map((e) => e.sentence)).toEqual(["This Claude Code didn't take the flags that make a desk lean, so desks start with your whole Claude Code setup from now on (heavier, and nothing you set up is left out)."]);
  });

  it('keeps the user’s guards even on the old way, where Claude Code reads the user’s own settings', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const w = await lean({ rejectFlags: true });
    userSetup(w);
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(3) });
    const old = JSON.parse(w.starts()[1]?.settings ?? '{}') as { hooks: Record<string, unknown[]>; permissions: { deny: string[] } };
    // The settings file holds only the office's; the user's own are read by Claude Code itself, as before 0.2.
    expect(Object.keys(old.hooks)).toEqual(['PermissionRequest', 'Stop', 'SubagentStop']);
    expect(old.permissions.deny).not.toContain('Read(//**/.env)');
  });
});

describe('a desk whose protections can’t all be carried', () => {
  const standard = (argv: string[] | undefined) => {
    for (const flag of ['--setting-sources', '--strict-mcp-config', '--tools']) expect(argv).not.toContain(flag);
  };

  async function startsStandard(w: World, because: string): Promise<void> {
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    const turn = await w.rec.waitFor(isTurn('ada'), { ms: forStarts(2) });
    expect(turn.result.ok).toBe(true);
    standard(w.starts()[0]?.argv);
    // The settings file holds only the office's: Claude Code reads the user's own, as it did before 0.2.
    expect(Object.keys(JSON.parse(w.starts()[0]?.settings ?? '{}').hooks)).toEqual(['PermissionRequest', 'Stop', 'SubagentStop']);
    const sentence = `Desks start with your whole Claude Code setup instead of the lean one, because ${because}. They are heavier, and nothing you set up is left out.`;
    expect(w.rec.heard.filter(isNotice).map((e) => e.sentence)).toEqual([sentence]);
    // A second person's desk, started the same way, doesn't say it again.
    w.board.deliver(w.plan('bo'), { text: 'And you.', messageId: 'm-2' });
    await w.rec.waitFor(isTurn('bo'), { ms: forStarts(2) });
    standard(w.starts()[1]?.argv);
    expect(w.rec.heard.filter(isNotice)).toHaveLength(1);
  }

  it('starts the standard way, and tells the stakeholder once, when the settings file can’t be read as JSON', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const w = await lean();
    writeFileSync(join(w.configDir, 'settings.json'), '{"permissions": {"deny": [');
    await startsStandard(w, "your Claude Code settings file couldn't be read as JSON, so the office can't tell what it protects");
  });

  it('does the same for a settings file over 8 MB', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const w = await lean();
    writeFileSync(join(w.configDir, 'settings.json'), JSON.stringify({ pad: 'x'.repeat(9 * 1024 * 1024) }));
    await startsStandard(w, 'your Claude Code settings file is bigger than 8 MB, so the office can’t tell what it protects'.replace('’', "'"));
  });

  it('does the same for a plugin hook the office can’t reproduce', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const w = await lean();
    const root = join(w.configDir, 'plugins', 'cache', 'guarded');
    mkdirSync(join(root, 'hooks'), { recursive: true });
    writeFileSync(join(w.configDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'guarded@market': true } }));
    writeFileSync(join(w.configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'guarded@market': [{ scope: 'user', installPath: root }] } }));
    writeFileSync(join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PLUGIN_DATA/guard.js"' }] }] } }));
    await startsStandard(w, "the guarded plugin's PreToolUse hook needs the plugin's own environment");
  });

  it("runs at the company's effort, or medium, whatever effortLevel the user's own settings have", async () => {
    const w = await lean();
    writeFileSync(join(w.configDir, 'settings.json'), JSON.stringify({ effortLevel: 'xhigh', env: { MAX_THINKING_TOKENS: '63999' } }));
    w.board.deliver(w.plan('ada'), { text: 'One.', messageId: 'm-1' });
    w.board.deliver(w.plan('bo', { effort: 'low' }), { text: 'Two.', messageId: 'm-2' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(2) });
    await w.rec.waitFor(isTurn('bo'), { ms: forStarts(2) });
    const by = new Map(w.starts().map((s) => [s.argv?.includes('--effort') ? flagValue(s.argv, '--effort') : null, s]));
    expect([...by.keys()].sort()).toEqual(['low', 'medium']);
    for (const s of w.starts()) expect(s.settings).not.toContain('effortLevel');
  });

  it('starts lean when everything can be carried, including hooks on every event and a matcher that matches everything', async () => {
    const w = await lean();
    const everything = { matcher: '', hooks: [{ type: 'prompt', prompt: 'Is this safe?' }] };
    writeFileSync(join(w.configDir, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [everything], PostToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] }, permissions: { ask: ['Bash(git push:*)'] } }));
    w.board.deliver(w.plan('ada'), { text: 'Build it.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    const [start] = w.starts();
    expect(start?.argv).toContain('--strict-mcp-config');
    const settings = JSON.parse(start?.settings ?? '{}') as { hooks: Record<string, unknown[]>; permissions: { ask: string[] } };
    expect(settings.hooks.PreToolUse).toEqual([everything]);
    expect(Object.keys(settings.hooks)).toEqual(['PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SubagentStop']);
    expect(settings.permissions.ask).toContain('Bash(git push:*)');
    expect(w.rec.heard.some(isNotice)).toBe(false);
  });
});

describe('the checks on what a lean desk says it loaded', () => {
  it('say once, and carry on, when init names no tools: nothing can be checked, and nothing is assumed', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const w = await lean({ omitTools: true });
    w.board.deliver(w.plan('ada'), { text: 'One.', messageId: 'm-1' });
    w.board.deliver(w.plan('bo'), { text: 'Two.', messageId: 'm-2' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(2) });
    await w.rec.waitFor(isTurn('bo'), { ms: forStarts(2) });
    expect(w.rec.heard.filter(isNotice).map((e) => e.sentence)).toEqual(["This Claude Code doesn't list a desk's tools when it starts, so the office can't check that a desk loaded only what it was given."]);
  });

  it('still refuse a desk whose init lists a server nobody assigned, even with no tool list', async () => {
    const w = await lean({ omitTools: true, leakServers: ['gmail'] });
    w.board.deliver(w.plan('ada'), { text: 'One.', messageId: 'm-1' });
    const refused = await w.rec.waitFor((e): e is Extract<typeof e, { kind: 'desk' }> => e.kind === 'desk' && e.view.person === 'ada' && (e.view.problem ?? '').includes('nobody assigned'), { ms: forStarts(3) });
    expect(refused.view.problem).toContain('(gmail)');
    expect(w.rec.heard.some(isTurn('ada'))).toBe(false);
  });

  it('delete the desk’s MCP file, which may hold a server’s secrets, as soon as init has been read', async () => {
    const w = await lean();
    userSetup(w);
    w.board.deliver(w.plan('ada', { loads: { tools: ['Read'], skills: false, mcp: ['github'] } }), { text: 'One.', messageId: 'm-1' });
    await w.rec.waitFor(isTurn('ada'), { ms: forStarts(1) });
    // The desk is still open (idle): its settings are there, the MCP file is not.
    const argv = w.starts()[0]?.argv ?? [];
    await until(() => !existsSync(flagValue(argv, '--mcp-config') ?? ''), 10_000, 'the MCP file to go');
    expect(existsSync(flagValue(argv, '--settings') ?? '')).toBe(true);
    expect(w.starts()[0]?.mcpConfig).toContain(SECRET);
  });

  it('go to the old way only on Claude Code’s own argument error, first on standard error, with exit code 1', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    // The same words, but after something else on standard error: a desk that crashed, not one that was refused.
    const later = await lean({ startup: { exit: { code: 1, stderr: "warning: something\nerror: unknown option '--tools'" } } });
    later.board.deliver(later.plan('ada'), { text: 'One.', messageId: 'm-1' });
    await later.rec.waitFor((e): e is Extract<typeof e, { kind: 'desk' }> => e.kind === 'desk' && e.view.person === 'ada' && e.view.problem !== null && e.view.problem !== undefined, { ms: forStarts(3) });
    await until(() => later.starts().length >= 2, forStarts(2), 'the automatic reopen');
    for (const s of later.starts()) expect(s.argv).toContain('--tools');
    expect(later.rec.heard.some(isNotice)).toBe(false);
    await open?.close();
    // Right words, wrong exit code.
    const code = await lean({ startup: { exit: { code: 2, stderr: "error: unknown option '--tools'" } } });
    code.board.deliver(code.plan('ada'), { text: 'One.', messageId: 'm-1' });
    await code.rec.waitFor((e): e is Extract<typeof e, { kind: 'desk' }> => e.kind === 'desk' && e.view.person === 'ada' && e.view.problem !== null && e.view.problem !== undefined, { ms: forStarts(3) });
    await until(() => code.starts().length >= 2, forStarts(2), 'the automatic reopen');
    for (const s of code.starts()) expect(s.argv).toContain('--tools');
    expect(code.rec.heard.some(isNotice)).toBe(false);
    expect(written.filter((l) => l.includes('flags that make a desk lean'))).toEqual([]);
  });
});
