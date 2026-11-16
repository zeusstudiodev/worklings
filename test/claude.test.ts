import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { costOf } from '../src/core/pricing.ts';
import { ZERO_USAGE } from '../src/core/usage.ts';
import { ClaudeError, claudeEnv, findClaude, parseClaudeOutput, READ_ONLY_FLAGS, runClaude } from '../src/server/claude.ts';
import { tempDir } from './library-kit.ts';

// Spies that call through to the real functions, so a test can see which process a run started and check it is gone.
vi.mock('node:child_process', { spy: true });

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const PRINT = fileURLToPath(new URL('./fixtures/claude-2.1.312/print/', import.meta.url));
const FAKE_SESSION = '0f4ce5e5-0000-4000-8000-00000000c1a0';
/** What the fake says a resumed session had cost before, as the real total_cost_usd does. */
const FAKE_EARLIER_COST = 0.25;
const NOT_SIGNED_IN = "Claude Code isn't signed in. Run claude in a terminal, sign in, then ask again.";
/** WORKLINGS_CLAUDE's name before the rename, which the office still reads. */
const LEGACY_CLAUDE = 'HEADCOUNT_CLAUDE';

interface FakeRun {
  argv: string[];
  cwd: string;
  stdin: string;
  hasClaudeCodeEnv: boolean;
  disablePromptCaching: string | null;
  mode: string;
  pid: number;
  childPid: number | null;
}

/**
 * The shell's environment with no way to the real Claude Code: neither name of the variable that picks it, and `path`
 * (an empty folder) as the PATH. A lookup that misses the fake fails as not installed and starts nothing.
 */
function noClaude(path: string): NodeJS.ProcessEnv {
  const shell = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', LEGACY_CLAUDE, 'PATH'].includes(name.toUpperCase()));
  return { ...Object.fromEntries(shell), PATH: path };
}

/**
 * A folder to run in and an environment that leads runClaude to the fake, never to the real Claude Code: `variable`
 * names the fake, and it is the only name of that variable set.
 */
function fake(mode = 'ok', variable = 'WORKLINGS_CLAUDE') {
  const dir = tempDir('worklings-claude-');
  const log = join(dir, 'runs.jsonl');
  const env: NodeJS.ProcessEnv = { ...noClaude(dir), [variable]: FAKE, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log };
  const runs = (): FakeRun[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as FakeRun) : []);
  const only = (): FakeRun => {
    const [run, ...more] = runs();
    if (!run || more.length > 0) throw new Error(`Expected one run of the fake, found ${runs().length}.`);
    return run;
  };
  return { dir, env, only };
}

function claudeError(fn: () => unknown): ClaudeError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ClaudeError) return error;
    throw error;
  }
  throw new Error('Expected a ClaudeError.');
}

async function rejection(run: Promise<unknown>): Promise<ClaudeError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ClaudeError) return error;
    throw error;
  }
  throw new Error('Expected runClaude to fail.');
}

/** The process the last run started. */
function lastPid(): number {
  const result = vi.mocked(spawn).mock.results.at(-1);
  if (result?.type !== 'return' || result.value.pid === undefined) throw new Error('No process was started.');
  return result.value.pid;
}

/** Whether a process still runs. On Linux an exited process can linger as a zombie until it is collected. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
  if (process.platform !== 'linux') return true;
  try {
    return !/\)\s+Z\s/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false; // it went between the two checks
  }
}

const files = (...paths: string[]) => (file: string) => paths.includes(file);
const printed = (name: string) => readFileSync(join(PRINT, name), 'utf8');
const resultJson = (fields: Record<string, unknown>) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...fields });

describe('findClaude', () => {
  it('uses the executable WORKLINGS_CLAUDE names before the PATH', () => {
    const exists = files('C:\\Tools\\claude.exe', 'C:\\Bin\\claude.exe');
    expect(findClaude({ WORKLINGS_CLAUDE: 'C:\\Tools\\claude.exe', PATH: 'C:\\Bin' }, 'win32', exists)).toEqual({
      found: true,
      command: 'C:\\Tools\\claude.exe',
      prefixArgs: [],
      path: 'C:\\Tools\\claude.exe',
    });
  });

  it('runs a JavaScript entry point in WORKLINGS_CLAUDE with the current Node', () => {
    expect(findClaude({ WORKLINGS_CLAUDE: FAKE })).toEqual({ found: true, command: process.execPath, prefixArgs: [FAKE], path: FAKE });
  });

  it('names WORKLINGS_CLAUDE and the path when there is no file there', () => {
    const missing = join(tempDir(), process.platform === 'win32' ? 'claude.exe' : 'claude');
    const lookup = findClaude({ WORKLINGS_CLAUDE: missing, PATH: '' });
    expect(lookup).toEqual({ found: false, reason: expect.stringContaining(`WORKLINGS_CLAUDE is set to ${missing}, but there is no file there.`) });
  });

  it('asks for a full path in WORKLINGS_CLAUDE', () => {
    expect(findClaude({ WORKLINGS_CLAUDE: 'claude.exe' }, 'win32', () => true)).toEqual({
      found: false,
      reason: expect.stringContaining('WORKLINGS_CLAUDE must be the full path'),
    });
  });

  it(`still finds Claude Code through ${LEGACY_CLAUDE}, its old name, when WORKLINGS_CLAUDE is unset or empty`, () => {
    const found = { found: true, command: process.execPath, prefixArgs: [FAKE], path: FAKE };
    expect(findClaude({ [LEGACY_CLAUDE]: FAKE })).toEqual(found);
    expect(findClaude({ WORKLINGS_CLAUDE: ' ', [LEGACY_CLAUDE]: FAKE })).toEqual(found);
  });

  it(`prefers WORKLINGS_CLAUDE to ${LEGACY_CLAUDE} when both are set`, () => {
    const exists = files('C:\\New\\claude.exe', 'C:\\Old\\claude.exe');
    expect(findClaude({ WORKLINGS_CLAUDE: 'C:\\New\\claude.exe', [LEGACY_CLAUDE]: 'C:\\Old\\claude.exe' }, 'win32', exists)).toMatchObject({
      found: true,
      command: 'C:\\New\\claude.exe',
    });
  });

  it(`says what is wrong with WORKLINGS_CLAUDE instead of falling back to ${LEGACY_CLAUDE}`, () => {
    const lookup = findClaude({ WORKLINGS_CLAUDE: 'C:\\Gone\\claude.exe', [LEGACY_CLAUDE]: 'C:\\Old\\claude.exe' }, 'win32', files('C:\\Old\\claude.exe'));
    expect(lookup).toEqual({ found: false, reason: expect.stringContaining('WORKLINGS_CLAUDE is set to C:\\Gone\\claude.exe, but there is no file there.') });
  });

  it(`names ${LEGACY_CLAUDE} and its new name when the path it holds leads nowhere`, () => {
    expect(findClaude({ [LEGACY_CLAUDE]: 'C:\\Old\\claude.exe' }, 'win32', files())).toEqual({
      found: false,
      reason: `${LEGACY_CLAUDE} (renamed WORKLINGS_CLAUDE) is set to C:\\Old\\claude.exe, but there is no file there. Set it to the full path of claude.exe or of Claude Code's cli.js.`,
    });
  });

  it('searches the PATH folder by folder, trying the PATHEXT extensions in their order', () => {
    const exists = files('C:\\Later\\claude.exe', 'C:\\Claude\\claude.com', 'C:\\Claude\\claude.exe');
    expect(findClaude({ PATH: 'C:\\Empty;C:\\Claude;C:\\Later', PATHEXT: '.EXE;.COM' }, 'win32', exists)).toMatchObject({
      found: true,
      command: 'C:\\Claude\\claude.exe',
    });
  });

  it('never looks for PATHEXT extensions that need a shell, such as .vbs and .js', () => {
    const checked: string[] = [];
    const exists = (file: string) => {
      checked.push(file);
      return file === 'C:\\Bin\\claude.exe';
    };
    expect(findClaude({ PATH: 'C:\\Scripts;C:\\Bin', PATHEXT: '.VBS;.JS;.EXE' }, 'win32', exists)).toMatchObject({ found: true, command: 'C:\\Bin\\claude.exe' });
    expect(checked).toEqual(['C:\\Scripts\\claude.exe', 'C:\\Bin\\claude.exe']);
  });

  it("uses Windows' default PATHEXT when it isn't set", () => {
    expect(findClaude({ PATH: 'C:\\Bin' }, 'win32', files('C:\\Bin\\claude.exe'))).toMatchObject({ found: true, command: 'C:\\Bin\\claude.exe' });
  });

  it('finds Claude Code in a PATH folder with spaces, and in one written in quotes', () => {
    const folder = 'C:\\Program Files\\Claude Code';
    const exists = files(`${folder}\\claude.exe`);
    // Windows keeps the variable's own case ("Path") in a copied environment.
    expect(findClaude({ Path: `C:\\Empty;${folder}` }, 'win32', exists)).toMatchObject({ found: true, command: `${folder}\\claude.exe` });
    expect(findClaude({ Path: `C:\\Empty;"${folder}"` }, 'win32', exists)).toMatchObject({ found: true, command: `${folder}\\claude.exe` });
  });

  it("runs npm's claude.cmd through the cli.js beside it, with the current Node", () => {
    const npm = 'C:\\Users\\Me\\AppData\\Roaming\\npm';
    const cli = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
    expect(findClaude({ PATH: npm }, 'win32', files(`${npm}\\claude.cmd`, cli))).toEqual({ found: true, command: process.execPath, prefixArgs: [cli], path: cli });
  });

  it('skips a claude.cmd that only a shell could run, and keeps looking', () => {
    const exists = files('C:\\Scripts\\claude.cmd', 'C:\\Bin\\claude.exe');
    expect(findClaude({ PATH: 'C:\\Scripts;C:\\Bin' }, 'win32', exists)).toMatchObject({ found: true, command: 'C:\\Bin\\claude.exe' });
  });

  it('says why it skipped a claude.cmd when nothing else is found', () => {
    expect(findClaude({ PATH: 'C:\\Scripts' }, 'win32', files('C:\\Scripts\\claude.cmd'))).toEqual({
      found: false,
      reason: "Found claude.cmd, which can only run through a shell; set WORKLINGS_CLAUDE to claude.exe or to Claude Code's cli.js.",
    });
  });

  it("says Claude Code isn't installed when nothing is found", () => {
    expect(findClaude({ PATH: 'C:\\Bin;C:\\Tools' }, 'win32', files())).toEqual({
      found: false,
      reason: "Claude Code isn't installed, or it isn't on the PATH the office sees. Install it, or set WORKLINGS_CLAUDE to the full path of claude.exe.",
    });
  });

  it('ignores empty and relative PATH entries, so a project folder cannot supply a claude of its own', () => {
    const exists = files('claude.exe', 'bin\\claude.exe', 'C:\\Bin\\claude.exe');
    expect(findClaude({ PATH: ';.;bin;C:\\Bin' }, 'win32', exists)).toMatchObject({ found: true, command: 'C:\\Bin\\claude.exe' });
  });

  it('looks for a plain claude file on the PATH on Linux and macOS', () => {
    const exists = files('/opt/tools/claude.exe', '/usr/local/bin/claude');
    expect(findClaude({ PATH: '/opt/tools:/usr/local/bin' }, 'linux', exists)).toEqual({
      found: true,
      command: '/usr/local/bin/claude',
      prefixArgs: [],
      path: '/usr/local/bin/claude',
    });
  });

  it('counts only files, not a folder with the same name', () => {
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const first = tempDir();
    const second = tempDir();
    mkdirSync(join(first, name));
    writeFileSync(join(second, name), '');
    expect(findClaude({ PATH: [first, second].join(delimiter) })).toMatchObject({ found: true, command: join(second, name) });
  });
});

describe('parseClaudeOutput', () => {
  it("reads Claude Code 2.1.312's real success result", () => {
    expect(parseClaudeOutput({ stdout: printed('fresh-success.json'), exitCode: 0 })).toEqual({
      text: 'Two plus two is four.',
      reportedCostUsd: 0.00036190000000000007,
      usage: { input: 3569, output: 10, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      model: 'claude-haiku-5-5',
      sessionId: 'ffafc833-424b-4c6d-84d6-c5a01c310929',
      durationMs: 6137,
    });
  });

  it("reads Claude Code 2.1.312's real not-signed-in result as not signed in, though its subtype says success", () => {
    expect(claudeError(() => parseClaudeOutput({ stdout: printed('not-signed-in.json'), exitCode: 1 }))).toMatchObject({
      code: 'not-signed-in',
      message: NOT_SIGNED_IN,
    });
  });

  it('says plainly when a fork reached for a tool instead of answering (seen on 2.1.312: empty result, out of turns)', () => {
    const stdout = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '', total_cost_usd: 0.0146, usage: { input_tokens: 29567, output_tokens: 425 } });
    expect(claudeError(() => parseClaudeOutput({ stdout, exitCode: 1 }))).toMatchObject({
      code: 'failed',
      message: 'It started to act on that instead of answering, and a side question can only be answered. Ask what it knows or plans instead.',
      detail: null,
    });
  });

  it('takes the last result from the array that --verbose prints', () => {
    const stdout = JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'result', subtype: 'success', is_error: false, result: 'An earlier result' },
      { type: 'assistant' },
      { type: 'result', subtype: 'success', is_error: false, result: 'The answer' },
    ]);
    expect(parseClaudeOutput({ stdout, exitCode: 0 }).text).toBe('The answer');
  });

  it("falls back to the entry's canonicalModel when the price table doesn't know the modelUsage key", () => {
    const profile = 'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/a1b2c3';
    expect(parseClaudeOutput({ stdout: resultJson({ result: 'Hi', modelUsage: { [profile]: { canonicalModel: 'claude-haiku-5-5' } } }) }).model).toBe('claude-haiku-5-5');
    const dated = resultJson({ result: 'Hi', modelUsage: { 'claude-sonnet-5-5-20261001': { canonicalModel: 'claude-sonnet-5-5' } } });
    expect(parseClaudeOutput({ stdout: dated }).model).toBe('claude-sonnet-5-5-20261001');
  });

  it('treats every field as untrusted', () => {
    const stdout = resultJson({
      result: 'Fine.',
      total_cost_usd: '0.5',
      usage: { input_tokens: -3, output_tokens: 'many' },
      modelUsage: ['claude-haiku-5-5'],
      session_id: '../../etc/passwd',
      duration_ms: -1,
    });
    expect(parseClaudeOutput({ stdout, elapsedMs: 1234.4 })).toEqual({
      text: 'Fine.',
      reportedCostUsd: null,
      usage: ZERO_USAGE,
      model: null,
      sessionId: null,
      durationMs: 1234,
    });
  });

  it.each([
    ['a usage limit, with its reset time', { result: "You've hit your limit · resets 3pm (Europe/Zurich)" }, 'limit', 'Claude Code has reached its usage limit. It resets 3pm (Europe/Zurich), so ask again then.'],
    ['an overloaded API', { result: 'API Error: 529 Overloaded', api_error_status: 529 }, 'limit', 'Claude is overloaded right now. Try again in a minute.'],
    ['a rate limit', { result: 'API Error', api_error_status: 429 }, 'limit', 'Claude Code has hit a limit: API Error'],
    ['an empty credit balance', { result: 'Credit balance is too low' }, 'limit', 'Claude Code has hit a limit: Credit balance is too low'],
    ['an invalid API key', { result: 'Invalid API key · Please run /login' }, 'not-signed-in', NOT_SIGNED_IN],
    ['an API 401', { result: 'API Error', api_error_status: 401 }, 'not-signed-in', NOT_SIGNED_IN],
    ['a prompt that is too long', { result: 'Prompt is too long' }, 'too-long', 'The prompt is too long for the model. Try a model with a larger context window.'],
    ['any other error', { result: 'API Error: 500 Internal server error\nRetried 10 times' }, 'failed', "Claude Code couldn't answer: API Error: 500 Internal server error"],
  ])('reads %s', (_case, fields, code, message) => {
    expect(claudeError(() => parseClaudeOutput({ stdout: resultJson({ is_error: true, ...fields }), exitCode: 1 }))).toMatchObject({ code, message });
  });

  it('reads an error subtype as a failure even when is_error is false', () => {
    const stdout = resultJson({ subtype: 'error_during_execution', is_error: false, errors: [] });
    expect(claudeError(() => parseClaudeOutput({ stdout, exitCode: 1 }))).toMatchObject({ code: 'failed', message: "Claude Code couldn't answer: error_during_execution" });
  });

  it("quotes only the first line of Claude Code's error, cut to about 160 characters", () => {
    const error = claudeError(() => parseClaudeOutput({ stdout: resultJson({ is_error: true, result: `API Error: ${'x'.repeat(300)}\nsecond line` }) }));
    expect(error.code).toBe('failed');
    expect(error.message.length).toBeLessThanOrEqual("Claude Code couldn't answer: ".length + 160);
    expect(error.message).not.toContain('second line');
  });

  it("reports output that isn't a result as bad output", () => {
    for (const stdout of ['Claude Code is thinking about it.', '{"type":"assistant"}', '[]', '', resultJson({ result: 42 })]) {
      expect(claudeError(() => parseClaudeOutput({ stdout, exitCode: 0 })).code).toBe('bad-output');
    }
  });

  it('quotes the first line of stderr, without colours or the stack trace, when Claude Code crashes', () => {
    const stderr = '\n\u001b[31mError: boom\u001b[39m\n    at main (cli.js:1:1)\n';
    expect(claudeError(() => parseClaudeOutput({ stdout: '', stderr, exitCode: 2 }))).toMatchObject({
      code: 'failed',
      message: 'Claude Code stopped with exit code 2: Error: boom',
    });
  });

  it('never quotes stdout when Claude Code fails without a result, since it could echo the prompt', () => {
    expect(claudeError(() => parseClaudeOutput({ stdout: 'my private prompt', stderr: '', exitCode: 1 }))).toMatchObject({
      code: 'failed',
      message: "Claude Code stopped with exit code 1 and didn't say why.",
    });
  });

  it('recognises a sign-in problem printed as plain text', () => {
    expect(claudeError(() => parseClaudeOutput({ stdout: '', stderr: 'Invalid API key · Please run /login\n', exitCode: 1 })).code).toBe('not-signed-in');
  });
});

describe('claudeEnv', () => {
  it('drops CLAUDECODE and turns prompt caching off, leaving the rest and the original alone', () => {
    const base = { PATH: '/usr/bin', CLAUDECODE: '1', DISABLE_PROMPT_CACHING: '0', HOME: '/home/me' };
    expect(claudeEnv(base, 'linux')).toEqual({ PATH: '/usr/bin', HOME: '/home/me', DISABLE_PROMPT_CACHING: '1' });
    expect(base).toEqual({ PATH: '/usr/bin', CLAUDECODE: '1', DISABLE_PROMPT_CACHING: '0', HOME: '/home/me' });
  });

  it(`passes WORKLINGS_CLAUDE and ${LEGACY_CLAUDE} through, like the rest of the office's own environment`, () => {
    const base = { PATH: '/usr/bin', WORKLINGS_CLAUDE: '/opt/claude/cli.js', [LEGACY_CLAUDE]: '/old/claude/cli.js' };
    expect(claudeEnv(base, 'linux')).toEqual({ ...base, DISABLE_PROMPT_CACHING: '1' });
  });

  it('matches variable names in any case on Windows', () => {
    expect(claudeEnv({ Path: 'C:\\Windows', ClaudeCode: '1', disable_prompt_caching: '0' }, 'win32')).toEqual({
      Path: 'C:\\Windows',
      DISABLE_PROMPT_CACHING: '1',
    });
  });

  it("leaves out the wiring of a Claude Code session the office runs in, and keeps the person's own configuration", () => {
    // What a Claude Code desktop session hands the processes it starts, next to the person's own settings.
    const host = {
      CLAUDECODE: '1', CLAUDE_PID: '4242', CLAUDE_EFFORT: 'high', ENABLE_IDE_INTEGRATION: 'true', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      CLAUDE_CODE_SESSION_ID: 'a1', CLAUDE_CODE_HOST_SESSION_ID: 'a0', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/s',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret', CLAUDE_CODE_TERMINAL_MCP_TOOLS: '1', CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1',
      CLAUDE_CODE_DESKTOP_APP: '1', CLAUDE_AGENT_SDK_VERSION: '0.2.0',
    };
    const own = {
      PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk', ANTHROPIC_BASE_URL: 'https://proxy.example', CLAUDE_CONFIG_DIR: '/home/me/.claude', HTTPS_PROXY: 'http://proxy:8080',
      CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
      CLAUDE_CODE_SKIP_FOUNDRY_AUTH: '1', CLAUDE_CODE_OAUTH_TOKEN: 'token', CLAUDE_CODE_CLIENT_CERT: '/c.pem', CLAUDE_CODE_CLIENT_KEY: '/k.pem',
      CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: 'p', CLAUDE_CODE_API_KEY_HELPER_TTL_MS: '60000', CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe',
    };
    expect(claudeEnv({ ...host, ...own }, 'linux')).toEqual({ ...own, DISABLE_PROMPT_CACHING: '1' });
    expect(claudeEnv({ Claude_Code_Entrypoint: 'cli', claude_agent_sdk_version: '1', claude_code_use_vertex: '1' }, 'win32')).toEqual({
      claude_code_use_vertex: '1',
      DISABLE_PROMPT_CACHING: '1',
    });
  });
});

describe('runClaude', () => {
  it('answers through Claude Code, with the read-only flags first and the prompt on stdin', async () => {
    const f = fake('ok');
    const prompt = 'What are you working on? Ünïcödé ✓, "quotes" & $(no shell)';
    const result = await runClaude({ args: ['--append-system-prompt', 'Answer in one sentence.'], input: prompt, cwd: f.dir, env: { ...f.env, CLAUDECODE: '1' } });
    expect(result).toMatchObject({ model: 'claude-haiku-5-5', sessionId: FAKE_SESSION });
    expect(result.text).toContain('Your prompt began: "What are you working on?');
    expect(result.usage.input).toBeGreaterThan(3000);
    expect(result.usage.output).toBeGreaterThan(0);
    // Not a fork, so what Claude Code reports is this run's own cost.
    expect(result.reportedCostUsd).toBeCloseTo(costOf('claude-haiku-5-5', result.usage) ?? Number.NaN, 12);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const run = f.only();
    expect(run.stdin).toBe(prompt);
    expect(run.argv).toEqual([...READ_ONLY_FLAGS, '--model', 'haiku', '--append-system-prompt', 'Answer in one sentence.']);
    expect(run.argv.some((arg) => arg.includes('What are you working on'))).toBe(false);
    expect(run.hasClaudeCodeEnv).toBe(false);
    expect(run.disablePromptCaching).toBe('1');
    expect(realpathSync.native(run.cwd)).toBe(realpathSync.native(f.dir));
  });

  it("passes the model, and keeps total_cost_usd as reported, which for a fork includes the session's earlier cost", async () => {
    const f = fake('ok');
    const result = await runClaude({ args: ['--resume', 'abc-123', '--fork-session'], model: 'claude-haiku-5-5', input: 'Hi', cwd: f.dir, env: f.env });
    expect(f.only().argv).toEqual([...READ_ONLY_FLAGS, '--model', 'claude-haiku-5-5', '--resume', 'abc-123', '--fork-session']);
    const own = costOf('claude-haiku-5-5', result.usage) ?? Number.NaN;
    expect(result.reportedCostUsd).toBeCloseTo(own + FAKE_EARLIER_COST, 12);
  });

  it('reads the array of messages that --verbose prints', async () => {
    const f = fake('ok');
    expect((await runClaude({ args: ['--verbose'], input: 'Hello', cwd: f.dir, env: f.env })).text).toContain('"Hello"');
  });

  it('waits for an answer that comes before the timeout', async () => {
    const f = fake('slow');
    const result = await runClaude({ args: [], input: 'Hello', cwd: f.dir, env: { ...f.env, FAKE_CLAUDE_DELAY_MS: '200' }, timeoutMs: 20_000 });
    expect(result.text).toContain('"Hello"');
  });

  it("says Claude Code isn't installed when it is nowhere on the PATH, and starts nothing", async () => {
    const empty = tempDir();
    vi.mocked(spawn).mockClear();
    const error = await rejection(runClaude({ args: [], input: 'Hi', cwd: empty, env: { PATH: empty } }));
    expect(error.code).toBe('not-installed');
    expect(error.message).toContain('WORKLINGS_CLAUDE');
    expect(spawn).not.toHaveBeenCalled();
  });

  it(`runs the Claude Code that ${LEGACY_CLAUDE} names when WORKLINGS_CLAUDE isn't set`, async () => {
    const f = fake('ok', LEGACY_CLAUDE);
    expect((await runClaude({ args: [], input: 'Hello', cwd: f.dir, env: f.env })).text).toContain('"Hello"');
    expect(f.only().stdin).toBe('Hello');
  });

  it('says Claude Code is missing when its file is gone by the time it starts', async () => {
    const dir = tempDir();
    const gone = join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    const error = await rejection(runClaude({ args: [], input: 'Hi', cwd: dir, claude: { found: true, command: gone, prefixArgs: [], path: gone } }));
    expect(error).toMatchObject({ code: 'not-installed', message: expect.stringContaining(gone) });
  });

  it("blames a missing working folder, not Claude Code, when the folder to run in doesn't exist", async () => {
    const f = fake('ok');
    const gone = join(f.dir, 'gone');
    expect(await rejection(runClaude({ args: [], input: 'Hi', cwd: gone, env: f.env }))).toMatchObject({
      code: 'failed',
      message: `Claude Code can't start in ${gone}: the folder doesn't exist.`,
    });
  });

  it("says Claude Code isn't signed in, from its real output", async () => {
    const f = fake('not-signed-in');
    expect(await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env }))).toMatchObject({ code: 'not-signed-in', message: NOT_SIGNED_IN });
  });

  it('reports a usage limit with its reset time (a marker in the prompt picks the mode)', async () => {
    const f = fake('ok');
    expect(await rejection(runClaude({ args: [], input: 'fake-claude:limit What is left?', cwd: f.dir, env: f.env }))).toMatchObject({
      code: 'limit',
      message: 'Claude Code has reached its usage limit. It resets 3pm (Europe/Zurich), so ask again then.',
    });
  });

  it('reports a prompt that is too long', async () => {
    const f = fake('too-long');
    expect((await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env }))).code).toBe('too-long');
  });

  it("reports output that isn't JSON as bad output", async () => {
    const f = fake('bad-json');
    expect((await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env }))).code).toBe('bad-output');
  });

  it('reports a crash with the first line Claude Code printed, not the stack trace', async () => {
    const f = fake('crash');
    expect(await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env }))).toMatchObject({
      code: 'failed',
      message: 'Claude Code stopped with exit code 2: Error: the fake Claude Code crashed on purpose',
    });
  });

  it("stops Claude Code when it doesn't answer in time, and the process is gone", async () => {
    const f = fake('hang');
    const error = await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env, timeoutMs: 500 }));
    expect(error).toMatchObject({ code: 'timed-out', message: "Claude Code didn't answer within 0.5 seconds, so the office stopped it." });
    expect(alive(lastPid())).toBe(false);
  });

  it('stops Claude Code and everything it started when the caller cancels', async () => {
    const f = fake('hang');
    const controller = new AbortController();
    const pending = rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env, signal: controller.signal }));
    // Wait until the fake is running and has started a process of its own.
    const run = await vi.waitFor(() => f.only(), { timeout: 20_000, interval: 20 });
    controller.abort();
    expect(await pending).toMatchObject({ code: 'cancelled', message: 'Cancelled before Claude Code answered.' });
    const childPid = run.childPid;
    if (childPid === null) throw new Error('The fake started no process of its own.');
    // The caller has its answer within 5 s; taskkill may take up to 30 s on a loaded machine, and must still get both.
    await vi.waitFor(() => {
      expect(alive(run.pid)).toBe(false);
      expect(alive(childPid)).toBe(false);
    }, { timeout: 35_000 });
  }, 60_000);

  it('starts nothing when the signal is already aborted', async () => {
    const f = fake('ok');
    vi.mocked(spawn).mockClear();
    expect((await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env, signal: AbortSignal.abort() }))).code).toBe('cancelled');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('stops Claude Code when it sends more than 4 MB', async () => {
    const f = fake('flood');
    expect(await rejection(runClaude({ args: [], input: 'Hi', cwd: f.dir, env: f.env }))).toMatchObject({
      code: 'bad-output',
      message: 'Claude Code sent more than 4 MB, so the office stopped it.',
    });
    expect(alive(lastPid())).toBe(false);
  });

  it.each([
    [['--tools', 'Bash']], [['--permission-mode=bypassPermissions']], [['--dangerously-skip-permissions']], [['--model', 'opus']], [['--settings', '{}']],
    [['--disallowedTools', 'Bash']], [['--disallowed-tools=Bash']],
  ])(
    'refuses %j from a caller, since it would undo the read-only flags',
    async (args) => {
      const f = fake('ok');
      vi.mocked(spawn).mockClear();
      await expect(runClaude({ args, input: 'Hi', cwd: f.dir, env: f.env })).rejects.toThrow("so callers can't pass it");
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [['--resume', '--debug', '--fork-session']], [['--resume=--debug']], [['--system-prompt', '-p']], [['--resume']], [['-r', '--fork-session']],
  ])('refuses %j, whose value would reach Claude Code as a flag of its own', async (args) => {
    const f = fake('ok');
    vi.mocked(spawn).mockClear();
    await expect(runClaude({ args, input: 'Hi', cwd: f.dir, env: f.env })).rejects.toThrow("needs a value that doesn't start with \"-\"");
    expect(spawn).not.toHaveBeenCalled();
  });

  it('turns off MCP tools as well as built-in ones, each list closed by the next flag', () => {
    const flags = READ_ONLY_FLAGS.join(' ');
    expect(flags).toContain("--tools  --disallowedTools mcp__* --strict-mcp-config");
  });

  it('refuses a model name that looks like a flag', async () => {
    const f = fake('ok');
    await expect(runClaude({ args: [], model: '--dangerously-skip-permissions', input: 'Hi', cwd: f.dir, env: f.env })).rejects.toThrow('is not a model name');
  });
});
