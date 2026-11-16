// Proves what Ask aside relies on, against the real Claude Code, with the runner's own flags and environment
// (src/server/claude.ts) from a neutral folder, as the office runs it: a forked, read-only, one-turn Haiku call
// answers from a session's context, leaves the original transcript as it was and no transcript of its own, runs no
// hooks, has no tools and no MCP servers, can't write a file when asked to, leaves the question nowhere on disk, and
// works while the session is in the middle of a turn. Spends a few cents of Haiku.
//
//   node scripts/check-fork.mjs [--keep]
//
// Writes test-results/fork-check.json (`npm run e2e` empties test-results/, so copy the report if you need it later).
// Run it again when Claude Code changes (see docs/claude-code-surfaces.md).
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const { READ_ONLY_FLAGS, claudeEnv } = await import('../src/server/claude.ts');

const keep = process.argv.includes('--keep');
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const claudeJson = join(homedir(), '.claude.json');
/** WORKLINGS_CLAUDE's name before the rename: read when the new one is unset or empty, as the office does. */
const LEGACY_CLAUDE_VARIABLE = 'HEADCOUNT_CLAUDE';
const claude = process.env.WORKLINGS_CLAUDE || process.env[LEGACY_CLAUDE_VARIABLE] || 'claude';
// The session under test runs like any session; the forks get exactly what the office gives them.
const sessionEnv = { ...process.env };
delete sessionEnv.CLAUDECODE;
const forkEnv = claudeEnv(process.env);

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sanitize = (path) => path.replace(/[^a-zA-Z0-9]/g, '-');
const log = (...args) => process.stderr.write(`${args.join(' ')}\n`);

/** Every file under a folder with its size and mtime, so a run's footprint can be diffed. */
function listFiles(root, skip = () => false) {
  const out = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (skip(path)) continue;
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) {
        try {
          const s = statSync(path);
          out.set(path, `${s.size}:${s.mtimeMs}`);
        } catch {
          // gone between readdir and stat
        }
      }
    }
  };
  walk(root);
  return out;
}

function changedFiles(before, after) {
  return [...after].filter(([path, stamp]) => before.get(path) !== stamp).map(([path]) => path);
}

/** Runs claude with arguments and stdin, never through a shell. */
function run(args, { cwd, env, input = '', timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(claude, args, { cwd, env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = stdout.split('\n').filter((l) => l.trim().startsWith('{'));
      const messages = lines.flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      const json = messages.findLast((m) => m.type === 'result') ?? null;
      const init = messages.find((m) => m.type === 'system' && m.subtype === 'init') ?? null;
      resolve({ code, json, init, stdout: json ? '' : stdout.slice(0, 2000), stderr: stderr.slice(0, 2000), ms: Date.now() - started });
    });
    child.stdin.end(input);
  });
}

const brief = (r) =>
  r.json
    ? {
        exit: r.code,
        isError: r.json.is_error,
        result: String(r.json.result ?? '').slice(0, 400),
        sessionId: r.json.session_id,
        // A fork's total includes what the original had cost; its own cost is its usage at list price.
        reportedCostUsd: r.json.total_cost_usd,
        usage: r.json.usage && { input: r.json.usage.input_tokens, output: r.json.usage.output_tokens, cacheRead: r.json.usage.cache_read_input_tokens, cacheWrite: r.json.usage.cache_creation_input_tokens },
        ms: r.ms,
      }
    : { exit: r.code, stdout: r.stdout, stderr: r.stderr, ms: r.ms };

// A capture server for hooks: the project's hooks post here, so we can see which sessions fired any.
const hookSessions = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      hookSessions.push({ session: p.session_id, event: p.hook_event_name });
    } catch {
      // ignore
    }
    res.writeHead(200);
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const hookPort = server.address().port;

const project = mkdtempSync(join(tmpdir(), 'worklings-fork-check-'));
const neutral = mkdtempSync(join(tmpdir(), 'worklings-fork-neutral-'));
const hook = { hooks: [{ type: 'http', url: `http://127.0.0.1:${hookPort}/hooks`, timeout: 2 }] };
mkdirSync(join(project, '.claude'), { recursive: true });
writeFileSync(
  join(project, '.claude', 'settings.local.json'),
  JSON.stringify({ hooks: { UserPromptSubmit: [hook], PreToolUse: [{ ...hook, matcher: '*' }], PostToolUse: [{ ...hook, matcher: '*' }], Stop: [hook], SessionEnd: [hook] } }, null, 2),
);
const transcripts = join(claudeHome, 'projects', sanitize(project));
const report = { claudeVersion: '', project, transcripts, flags: [...READ_ONLY_FLAGS], steps: {} };
const forkArgs = (session, ...extra) => [...READ_ONLY_FLAGS, '--model', 'haiku', ...extra, '--resume', session, '--fork-session'];

try {
  report.claudeVersion = await new Promise((resolve) => {
    const c = spawn(claude, ['--version'], { env: sessionEnv, shell: false, windowsHide: true });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', () => resolve(out.trim()));
  });
  log('Claude Code', report.claudeVersion);

  // 1. A finished session that knows a codeword nobody else could guess.
  const codeword = `PLUM-${Math.floor(1000 + Math.random() * 9000)}`;
  const original = randomUUID();
  const made = await run(['-p', '--model', 'haiku', '--session-id', original, '--output-format', 'json'], {
    cwd: project,
    env: sessionEnv,
    input: `Remember this codeword for later: ${codeword}. Reply with just OK.`,
  });
  report.steps.original = { ...brief(made), hooksFired: hookSessions.filter((h) => h.session === original).map((h) => h.event) };
  const originalFile = join(transcripts, `${original}.jsonl`);
  if (!existsSync(originalFile)) throw new Error(`The original session left no transcript at ${originalFile}`);

  const marker = `side-question-${randomUUID().slice(0, 8)}`;
  const skipOtherProjects = (path) => path.startsWith(join(claudeHome, 'projects')) && !path.startsWith(transcripts) && path !== join(claudeHome, 'projects');
  const holdsMarker = (path) => {
    try {
      return readFileSync(path, 'utf8').includes(marker);
    } catch {
      return false;
    }
  };

  /** One fork from the neutral folder with the office's flags and environment, and everything it left behind. */
  const fork = async (label, question, extra = []) => {
    const hashBefore = sha(originalFile);
    const filesBefore = listFiles(claudeHome, skipOtherProjects);
    const hooksBefore = hookSessions.length;
    const r = await run(forkArgs(original, ...extra), { cwd: neutral, env: forkEnv, input: `[${marker}] ${question}` });
    const changed = changedFiles(filesBefore, listFiles(claudeHome, skipOtherProjects));
    const step = {
      result: brief(r),
      originalUnchanged: sha(originalFile) === hashBefore,
      transcriptsLeft: readdirSync(transcripts).filter((f) => f.endsWith('.jsonl') && f !== `${original}.jsonl`),
      filesChanged: changed.map((p) => p.slice(claudeHome.length)),
      filesWithTheQuestion: [...changed.filter(holdsMarker), ...(holdsMarker(claudeJson) ? ['~/.claude.json'] : [])],
      hooksFired: hookSessions.slice(hooksBefore).map((h) => `${h.event}:${h.session === original ? 'original' : h.session}`),
    };
    if (r.init) step.init = { tools: r.init.tools, mcpServers: r.init.mcp_servers, permissionMode: r.init.permissionMode };
    report.steps[label] = step;
    log(label, JSON.stringify({ unchanged: step.originalUnchanged, left: step.transcriptsLeft, hooks: step.hooksFired, init: step.init, answer: step.result.result?.slice(0, 120) }));
    return step;
  };

  // 2. It answers from the session's context.
  const answered = await fork('fork', 'A side question from the person watching your studio. Answer in the first person, in one short sentence: what is the codeword you were asked to remember?');
  report.steps.fork.answeredFromContext = answered.result.result?.includes(codeword) ?? false;

  // 3. Its init message lists no tools and no MCP servers (the same flags, with the stream that carries the init).
  const flags = READ_ONLY_FLAGS.map((f) => (f === 'json' ? 'stream-json' : f));
  const initRun = await run([...flags, '--verbose', '--model', 'haiku', '--resume', original, '--fork-session'], { cwd: neutral, env: forkEnv, input: `[${marker}] Reply with the single word OK.` });
  report.steps.init = { tools: initRun.init?.tools ?? null, mcpServers: initRun.init?.mcp_servers ?? null, permissionMode: initRun.init?.permissionMode ?? null, result: brief(initRun) };
  log('init', JSON.stringify(report.steps.init.tools), JSON.stringify(report.steps.init.mcpServers));

  // 4. Asked to write a file, it can't.
  const target = 'fork-wrote-this.txt';
  await fork('write', `Create a file named ${target} in the current folder containing the word hello, then tell me in one sentence whether you could.`);
  report.steps.write.fileWritten = existsSync(join(neutral, target)) || existsSync(join(project, target));

  // 5. A session in the middle of a turn: it waits on a 40-second command while we fork it.
  const busy = randomUUID();
  const busyFile = join(transcripts, `${busy}.jsonl`);
  // A plain command, so the permission rule matches it exactly (parentheses inside Bash(...) rules confuse them).
  const command = 'sleep 40';
  const busyRun = run(['-p', '--model', 'haiku', '--session-id', busy, '--output-format', 'json', '--allowedTools', `Bash(${command})`], {
    cwd: project,
    env: sessionEnv,
    input: `Use the Bash tool to run exactly this command, with a timeout of 120000 ms: ${command}\nWhen it has finished, reply with the single word DONE.`,
    timeoutMs: 180_000,
  });
  let busyFinishedAt = Infinity;
  void busyRun.then(() => (busyFinishedAt = Date.now()));
  const waitStart = Date.now();
  while (!(existsSync(busyFile) && readFileSync(busyFile, 'utf8').includes('"tool_use"'))) {
    if (Date.now() - waitStart > 60_000) throw new Error('The busy session never started its command.');
    await new Promise((r) => setTimeout(r, 500));
  }
  const prefix = readFileSync(busyFile);
  const hooksBefore = hookSessions.length;
  const busyFork = await run(forkArgs(busy), { cwd: neutral, env: forkEnv, input: `[${marker}-busy] A side question from the person watching your studio. Answer in the first person, in one short sentence: what are you doing right now?` });
  const forkFinishedAt = Date.now();
  const busyDone = await busyRun;
  const after = readFileSync(busyFile);
  report.steps.busy = {
    fork: brief(busyFork),
    forkAnsweredWhileRunning: forkFinishedAt < busyFinishedAt,
    forkSecondsBeforeOriginalFinished: Math.round((busyFinishedAt - forkFinishedAt) / 1000),
    original: brief(busyDone),
    originalFinishedNormally: Boolean(busyDone.json && /DONE/.test(String(busyDone.json.result))),
    prefixUnchanged: after.subarray(0, prefix.length).equals(prefix),
    originalHasTheQuestion: after.toString('utf8').includes(`${marker}-busy`),
    transcriptsLeft: readdirSync(transcripts).filter((f) => f.endsWith('.jsonl') && f !== `${original}.jsonl` && f !== `${busy}.jsonl`),
    forkHooksFired: hookSessions.slice(hooksBefore).filter((h) => h.session !== busy).map((h) => `${h.event}:${h.session}`),
  };
  log('busy', JSON.stringify({ answer: report.steps.busy.fork.result, prefix: report.steps.busy.prefixUnchanged, left: report.steps.busy.transcriptsLeft }));
  report.questionInClaudeJson = holdsMarker(claudeJson);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  server.close();
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/fork-check.json', `${JSON.stringify(report, null, 2)}\n`);
  if (!keep) {
    for (const dir of [project, neutral, transcripts]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  log('Wrote test-results/fork-check.json');
}
