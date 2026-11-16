// v0.7's parity contract (SPEC-v0.7.md, "Parity by construction"): the default job's launch, built by the real company
// and the real switchboard and caught by the fake desk, against plain `claude -p` given the same prompt and choices. It
// passes only when the differences are exactly the allowed list (ALLOWED_DIFFERENCES in src/core/plain.ts): adding a
// flag, appending prompt text, taking a tool away or changing a rule here fails it.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeskControl, DeskEvents } from '../src/core/company.ts';
import { ALLOWED_DIFFERENCES, DEFAULT_LAUNCH, type PlainLaunch } from '../src/core/plain.ts';
import { createCompany } from '../src/company/index.ts';
import { createSwitchboard } from '../src/runtime/index.ts';
import { deskEnvironment, officeHooks } from '../src/runtime/harness.ts';
import { plainClaudeArgs, plainDeskArgs, plainDeskSettings } from '../src/runtime/plain-desk.ts';
import { deskEnv } from '../src/server/claude.ts';
import { fakeGit, fakeOrg, KEY, newProject } from './company-kit.ts';
import { tempDir } from './library-kit.ts';
import { alive, FAKE_DESK, fakeHub, type FakeLogEntry, forStarts, until } from './runtime-kit.ts';

/** Flags that take no value in these launches. */
const SWITCHES = new Set(['-p', '--verbose']);

/** A command line as [flag, value] pairs, in order; a switch's value is null. */
function pairsOf(args: readonly string[]): [string, string | null][] {
  const out: [string, string | null][] = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] ?? '';
    if (!flag.startsWith('-')) throw new Error(`A bare word in the launch: ${flag}`);
    if (SWITCHES.has(flag)) out.push([flag, null]);
    else out.push([flag, args[++i] ?? '']);
  }
  return out;
}

/** What the desk's launch has beyond plain claude's, after checking it has everything plain claude has. */
function extraOver(desk: readonly string[], plain: readonly string[]): [string, string | null][] {
  const left = pairsOf(desk);
  for (const [flag, value] of pairsOf(plain)) {
    const at = left.findIndex(([f, v]) => f === flag && v === value);
    if (at < 0) throw new Error(`The desk's launch lacks plain claude's ${flag} ${value ?? ''}`);
    left.splice(at, 1);
  }
  return left;
}

const PROMPT = [
  'Fix the failing test in src/total.ts.',
  '',
  'Keep the public API as it is. Quotes "like this", a backslash \\ and a line that starts with --flag stay verbatim.',
].join('\n');

async function launched(launch: PlainLaunch) {
  const dir = tempDir('worklings-parity-');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  const logFile = join(dir, 'desk.jsonl');
  writeFileSync(join(dir, 'script.json'), JSON.stringify({}));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE'].includes(k.toUpperCase()))),
    WORKLINGS_CLAUDE: FAKE_DESK,
    FAKE_DESK_SCRIPT: join(dir, 'script.json'),
    FAKE_DESK_LOG: logFile,
    FAKE_DESK_SESSIONS: join(dir, 'sessions'),
  };
  const hub = await fakeHub();
  const root = newProject();
  const before = readdirSync(root).sort();
  const git = fakeGit();
  const company = createCompany({
    key: KEY, org: fakeOrg(), git, warn: () => {}, root, prompt: PROMPT, stakeholder: 'Robin', shape: 'plain', launch,
    desks: (events: DeskEvents, companyId: string): DeskControl => createSwitchboard({ companyId, root, hub, events, maxDesks: 4, idleMs: 60_000, env, claude: FAKE_DESK, scratch }),
  });
  const log = (): FakeLogEntry[] => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry) : []);
  try {
    await until(() => log().some((e) => e.event === 'line'), 30_000, 'the first turn to reach the desk');
    const start = log().find((e) => e.event === 'start') as FakeLogEntry & { argv: string[]; settings: string | null; mcpConfig: string | null; tmp: Record<string, string | null> };
    const first = log().find((e) => e.event === 'line') as FakeLogEntry & { line: unknown };
    const line = (typeof first.line === 'string' ? JSON.parse(first.line) : first.line) as { type: string; message: { role: string; content: unknown } };
    return { start, first: line, root, before, after: readdirSync(root).sort(), gitCalls: git.calls.length, hubUrl: hub.url, scratch };
  } finally {
    await company.close();
    await hub.close();
    const pids = log().flatMap((e) => (e.event === 'start' ? [e.pid] : []));
    await until(() => pids.every((pid) => !alive(pid)), 10_000, 'the desks to be gone');
  }
}

describe('the parity contract', () => {
  it('lists four allowed differences, none of them a change to the work', () => {
    expect(ALLOWED_DIFFERENCES).toHaveLength(4);
  });

  for (const [name, launch] of [
    ['left to Claude Code', DEFAULT_LAUNCH],
    ['with a model, an effort and a permission mode', { model: 'sonnet', effort: 'high', permissionMode: 'bypassPermissions', planFirst: false }],
  ] as const) {
    it(`launches the default desk as plain claude -p, ${name}, plus only the allowed differences`, async () => {
      const r = await launched(launch);
      const extra = extraOver(r.start.argv, plainClaudeArgs({ prompt: PROMPT, launch }));
      const flags = extra.map(([f]) => f).sort();
      // Observation (stream-json both ways, verbose), session persistence (a fresh session id), and the office's hooks.
      expect(flags).toEqual(['--input-format', '--output-format', '--session-id', '--settings', '--verbose']);
      expect(extra.find(([f]) => f === '--input-format')?.[1]).toBe('stream-json');
      expect(extra.find(([f]) => f === '--output-format')?.[1]).toBe('stream-json');
      expect(extra.find(([f]) => f === '--session-id')?.[1]).toMatch(/^[0-9a-f-]{36}$/);
      // Nothing that changes the work: no appended prompt, agent, tools list, setting sources, MCP config, effort or mode of the office's.
      for (const banned of ['--append-system-prompt', '--system-prompt', '--agent', '--tools', '--allowedTools', '--disallowedTools', '--setting-sources', '--strict-mcp-config', '--mcp-config', '--add-dir', '--max-turns']) {
        expect(r.start.argv).not.toContain(banned);
      }
      expect(r.start.mcpConfig).toBeNull();
      // The settings file holds the office's hooks and nothing else: no permission rules, model, environment or memory excludes.
      const settings = JSON.parse(r.start.settings ?? '{}') as Record<string, unknown>;
      expect(Object.keys(settings)).toEqual(['hooks']);
      expect(settings).toEqual(plainDeskSettings(officeHooks(r.hubUrl)));
      const hooks = settings.hooks as Record<string, { matcher?: string }[]>;
      expect(Object.keys(hooks).sort()).toEqual(['PermissionRequest', 'PreToolUse', 'Stop', 'SubagentStop']);
      expect(hooks.PreToolUse?.[0]?.matcher).toBe('Bash|PowerShell');
      // The person's words, verbatim, as the first user message: nothing before or after them.
      expect(r.first.type).toBe('user');
      expect(r.first.message).toEqual({ role: 'user', content: PROMPT });
      // The machine's own temporary folder, not a scratch folder of the office's.
      expect(r.start.tmp.TEMP).toBe(process.env.TEMP ?? null);
      // Nothing written into the project but the office's own records, and no git.
      expect(r.after.filter((f) => !r.before.includes(f))).toEqual(['.worklings']);
      expect(r.gitCalls).toBe(0);
    }, forStarts(2));
  }

  it("gives the desk the person's environment, less the host session's wiring, plus only the session events and the hooks' token", () => {
    const base = { PATH: '/bin', ANTHROPIC_MODEL: 'sonnet', CLAUDE_CONFIG_DIR: '/home/x/.claude', HTTPS_PROXY: 'http://proxy', TEMP: '/tmp/x', CLAUDECODE: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' };
    // A known gap, not an allowed difference: CLAUDE_CODE_* variables of the shell that starts Worklings don't reach a desk,
    // because a Claude Code session's own wiring (dozens of them) can't be told from them. Settings files' env blocks do.
    expect(deskEnv(base, 'linux').CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined();
    const plain = deskEnv(base, 'linux');
    const desk = deskEnvironment(base, 'token', null, 'linux');
    const added = Object.keys(desk).filter((k) => !(k in plain)).sort();
    expect(added).toEqual(['CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', 'WORKLINGS_DESK_TOKEN']);
    for (const [k, v] of Object.entries(plain)) expect(desk[k]).toBe(v);
  });

  it("adds a budget only as Claude Code's own cap on what is left of it, which stops the session and never steers it", () => {
    const args = plainDeskArgs({ sessionId: 'a', resume: false, launch: { ...DEFAULT_LAUNCH, budgetUsd: 2.5 }, settingsFile: 's.json' });
    expect(extraOver(args, plainClaudeArgs({ prompt: PROMPT, launch: DEFAULT_LAUNCH })).map(([f, v]) => `${f} ${v ?? ''}`.trim())).toEqual([
      '--input-format stream-json', '--output-format stream-json', '--verbose', '--session-id a', '--max-budget-usd 2.50', '--settings s.json',
    ]);
    expect(plainDeskArgs({ sessionId: 'a', resume: true, launch: { ...DEFAULT_LAUNCH, budgetUsd: null }, settingsFile: 's.json' })).not.toContain('--max-budget-usd');
  });

  it('adds the stdio permission host only for plan first, which needs it for ExitPlanMode', () => {
    const plain = plainClaudeArgs({ prompt: PROMPT, launch: { ...DEFAULT_LAUNCH, planFirst: true } });
    expect(plain).toEqual(['-p', '--permission-mode', 'plan']);
  });
});
