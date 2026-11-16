// A stand-in for Claude Code's print mode (`claude -p --output-format json`) for the unit tests and the end-to-end
// suite. It never calls a model or the network. Point WORKLINGS_CLAUDE at this file and the office runs it with the
// current Node.
//
// It reads its arguments and all of stdin, then acts by mode: a `fake-claude:<mode>` marker in stdin wins, then the
// FAKE_CLAUDE_MODE variable, else `ok`.
//   ok             a success result shaped like Claude Code 2.1.312's (fixtures/claude-2.1.312/print/fresh-success.json)
//                  whose text quotes the start of the prompt, priced at Haiku 5.5's list prices. With --resume,
//                  total_cost_usd also counts what the resumed session had cost before, as the real one does, while
//                  usage covers only this run.
//   slow           the same after FAKE_CLAUDE_DELAY_MS milliseconds (3000 unless set)
//   hang           starts a child process of its own and never answers (gives up after five minutes)
//   not-signed-in  Claude Code 2.1.312's real not-signed-in result, exit code 1
//   limit          an error result for a usage limit with its reset time, exit code 1
//   too-long       an error result for a prompt that is too long, exit code 1
//   bad-json       plain text, exit code 0
//   crash          an error with a stack trace on stderr, exit code 2
//   flood          more than 4 MB on stdout, then never answers
// With --verbose the result comes last in an array of messages, as Claude Code prints it then.
// With FAKE_CLAUDE_LOG set it appends one JSON line per run:
//   { argv, cwd, stdin, hasClaudeCodeEnv, disablePromptCaching, mode, pid, childPid }
// It records nothing else from the environment.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { answerClaudeCommand } from './fake-claude-cli.mjs';

// `--version` and `auth status` are answered there (FAKE_CLAUDE_VERSION, FAKE_CLAUDE_AUTH), before any stdin is read.
await answerClaudeCommand(process.argv.slice(2));

const MODES = ['ok', 'slow', 'hang', 'not-signed-in', 'limit', 'too-long', 'bad-json', 'crash', 'flood'];
const GIVE_UP_MS = 5 * 60_000;
const MODEL = 'claude-haiku-5-5';
const SESSION_ID = '0f4ce5e5-0000-4000-8000-00000000c1a0';
/** What a resumed session had cost before this run: the real total_cost_usd includes it for --resume --fork-session. */
const EARLIER_COST_USD = 0.25;

const started = Date.now();
const argv = process.argv.slice(2);

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let text = '';
  try {
    for await (const chunk of process.stdin) text += chunk;
  } catch {
    // stdin closed abruptly: answer what arrived, as Claude Code would.
  }
  return text;
}

function record(stdin, mode, extra = {}) {
  const file = process.env.FAKE_CLAUDE_LOG;
  if (!file) return;
  const line = {
    argv,
    cwd: process.cwd(),
    stdin,
    hasClaudeCodeEnv: 'CLAUDECODE' in process.env,
    disablePromptCaching: process.env.DISABLE_PROMPT_CACHING ?? null,
    mode,
    pid: process.pid,
    childPid: null,
    ...extra,
  };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}

function usageBlock(input, output) {
  return {
    input_tokens: input,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: output,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo: 'global',
    iterations: input + output > 0 ? [{ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, type: 'message' }] : [],
    speed: 'standard',
    fallback_credit: null,
  };
}

function print(result) {
  const messages = [
    { type: 'system', subtype: 'init', session_id: SESSION_ID, model: MODEL, tools: [], mcp_servers: [] },
    { type: 'assistant', session_id: SESSION_ID, message: { role: 'assistant', model: MODEL, content: [{ type: 'text', text: String(result.result ?? '') }] } },
    result,
  ];
  process.stdout.write(`${JSON.stringify(argv.includes('--verbose') ? messages : result)}\n`);
}

function failure(text) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: true,
    api_error_status: null,
    duration_ms: Date.now() - started,
    duration_api_ms: 0,
    num_turns: 1,
    result: text,
    stop_reason: 'stop_sequence',
    session_id: SESSION_ID,
    total_cost_usd: 0,
    usage: usageBlock(0, 0),
    modelUsage: {},
    permission_denials: [],
    terminal_reason: 'api_error',
    uuid: randomUUID(),
  };
}

function answer(stdin) {
  const start = stdin.replace(/\s+/g, ' ').trim();
  const text = `This is the fake Claude Code. Your prompt began: "${start.length > 80 ? `${start.slice(0, 79)}…` : start}"`;
  // A rough count, about four characters a token, on top of a system prompt.
  const input = 3000 + Math.ceil(stdin.length / 4);
  const output = Math.ceil(text.length / 4);
  // Haiku 5.5 list prices per million tokens, higher for prompts over 100K tokens (see src/core/pricing.ts).
  const [inputRate, outputRate] = input > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
  const own = (input * inputRate + output * outputRate) / 1_000_000;
  const total = argv.includes('--resume') ? own + EARLIER_COST_USD : own;
  print({
    type: 'result',
    subtype: 'success',
    is_error: false,
    api_error_status: null,
    duration_ms: Date.now() - started,
    duration_api_ms: 1200,
    num_turns: 1,
    result: text,
    stop_reason: 'end_turn',
    session_id: SESSION_ID,
    total_cost_usd: total,
    usage: usageBlock(input, output),
    modelUsage: {
      [MODEL]: {
        inputTokens: input,
        outputTokens: output,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: total,
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        thinkingTokens: 0,
        cacheCreationEphemeral5mInputTokens: 0,
        cacheCreationEphemeral1hInputTokens: 0,
        canonicalModel: MODEL,
        provider: 'firstParty',
        costBasis: 'list',
      },
    },
    permission_denials: [],
    terminal_reason: 'completed',
    uuid: randomUUID(),
  });
}

/** Keeps the process alive as if it were still thinking, but not forever if nobody kills it. */
const giveUpLater = () => setTimeout(() => process.exit(4), GIVE_UP_MS);

function delayMs() {
  const ms = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 3000);
  return Number.isFinite(ms) && ms >= 0 ? ms : 3000;
}

const stdin = await readStdin();
const mode = /fake-claude:([a-z-]+)/.exec(stdin)?.[1] ?? (process.env.FAKE_CLAUDE_MODE || 'ok');

if (!MODES.includes(mode)) {
  process.stderr.write(`fake-claude: unknown mode "${mode}"; use one of ${MODES.join(', ')}.\n`);
  process.exitCode = 3;
} else if (mode === 'hang') {
  // On Windows, Node puts the children it starts in a job that dies with it; detached, this one stays outside, as a
  // real claude.exe's children would, so only killing the whole tree stops it. Elsewhere it must share the group.
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${GIVE_UP_MS})`], {
    stdio: 'ignore',
    windowsHide: true,
    detached: process.platform === 'win32',
  });
  record(stdin, mode, { childPid: child.pid ?? null });
  giveUpLater();
} else {
  record(stdin, mode);
  if (mode === 'ok') answer(stdin);
  else if (mode === 'slow') setTimeout(() => answer(stdin), delayMs());
  else if (mode === 'not-signed-in') {
    print(JSON.parse(readFileSync(new URL('./fixtures/claude-2.1.312/print/not-signed-in.json', import.meta.url), 'utf8')));
    process.exitCode = 1;
  } else if (mode === 'limit') {
    print(failure("You've hit your limit · resets 3pm (Europe/Zurich)"));
    process.exitCode = 1;
  } else if (mode === 'too-long') {
    print(failure('Prompt is too long'));
    process.exitCode = 1;
  } else if (mode === 'bad-json') {
    process.stdout.write('Claude Code is thinking about it.\n');
  } else if (mode === 'crash') {
    process.stderr.write('Error: the fake Claude Code crashed on purpose\n    at main (fake-claude.mjs:1:1)\n    at run (fake-claude.mjs:2:2)\n');
    process.exitCode = 2;
  } else if (mode === 'flood') {
    process.stdout.write('x'.repeat(5 * 1024 * 1024));
    giveUpLater();
  }
}
