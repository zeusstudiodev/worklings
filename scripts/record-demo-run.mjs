#!/usr/bin/env node
// Records one real plain job for the static demo's "Try it" replay (SPEC-v0.8.md, "Create one from scratch"). It COSTS
// MONEY: the job runs on the real Claude Code, signed in as usual. Run it from a terminal with CLAUDECODE unset, rarely,
// and never in a loop. Everything it starts is its own: a throwaway WORKLINGS_HOME, a hub on its own port and an empty
// temp project. It never moves CLAUDE_CONFIG_DIR and never reads or copies credentials.
//
//   node scripts/record-demo-run.mjs --out <folder outside the repo> [--port 4388] [--cap 7] [--model sonnet]
//
// The job's project gets `.claude/settings.json` with `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (Sonnet keeps no todo list
// without it), and the job runs in acceptEdits with every command allowed but `npm test`, which asks: one permission
// prompt, the way a person's own rules could make it. The script answers like a person would: each permission prompt is allowed once after a few
// seconds. The job is done when its turn has ended with its last words in the inbox, no helper still works and nothing
// has moved for a while (a turn can end while a background helper still works; the session goes on when it reports). It writes every snapshot
// the hub streamed, with the time it arrived, to `<out>/raw.jsonl`, and a summary to `<out>/run.json`. Turn it into the
// demo's fixture with `node scripts/make-demo-replay.mjs`.
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    port: { type: 'string', default: '4388' },
    cap: { type: 'string', default: '7' },
    model: { type: 'string', default: 'sonnet' },
    minutes: { type: 'string', default: '15' },
    // A free dry run of the plumbing with the fake desk (test/fake-desk.mjs) instead of Claude Code.
    fake: { type: 'boolean', default: false },
  },
});
if (!values.out) throw new Error('--out names the folder the recording goes to (outside the repo).');
if (process.env.CLAUDECODE) throw new Error('Unset CLAUDECODE first: this runs the real Claude Code.');
if (process.env.WORKLINGS_CLAUDE && !values.fake) throw new Error('Unset WORKLINGS_CLAUDE: the recording is of the real Claude Code.');

/** The words the job starts with, as a person would type them. The demo prefills its start form with these. */
export const PROMPT =
  'Build haiku-check, a tiny zero-dependency Node CLI that reads a poem from a file, counts the syllables on each line ' +
  'and says whether it is a haiku (5, 7, 5). Keep a todo list as you go, and have a subagent write the tests with ' +
  'node:test while you write the code. Finish by running npm test. No questions needed: make the small calls yourself.';

const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const port = Number(values.port);
const cap = Number(values.cap);
const scratch = join(tmpdir(), `worklings-record-${Date.now()}`);
const home = join(scratch, 'home');
const project = join(scratch, 'projects', 'haiku-check');
mkdirSync(join(home, '.worklings'), { recursive: true });
mkdirSync(join(project, '.claude'), { recursive: true });
// A made-up stakeholder, so no real name reaches the recording.
writeFileSync(join(home, '.worklings', 'settings.json'), JSON.stringify({ stakeholder: 'Robin' }));
writeFileSync(
  join(project, '.claude', 'settings.json'),
  `${JSON.stringify(
    {
      env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
      // Every other command runs without asking; `npm test` asks, as a person's own rules might have it (an ask rule wins
      // over an allow rule, and Claude Code checks each part of a compound command).
      permissions: { allow: ['Read', 'Glob', 'Grep', 'Bash', 'PowerShell'], ask: ['Bash(npm test*)', 'PowerShell(npm test*)'] },
    },
    null,
    2,
  )}\n`,
);

const env = { ...process.env, WORKLINGS_HOME: home };
delete env.CLAUDECODE;
delete env.WORKLINGS_CLAUDE;
if (values.fake) env.WORKLINGS_CLAUDE = resolve(import.meta.dirname, '..', 'test', 'fake-desk.mjs');
const hub = spawn(process.execPath, ['src/cli.ts', 'hub', '--port', String(port), '--no-open'], { cwd: resolve(import.meta.dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const hubLog = createWriteStream(join(out, 'hub.log'));
hub.stdout.pipe(hubLog);
hub.stderr.pipe(hubLog);
const summary = { pid: hub.pid, port, scratch, startedAt: Date.now(), prompt: PROMPT, model: values.model, frames: 0, approvals: [], answers: [], spend: 0, ended: null };
writeFileSync(join(out, 'run.json'), JSON.stringify(summary, null, 2));
console.log(`hub pid ${hub.pid} on ${port}; scratch ${scratch}`);
// Whatever ends this script (a failed request, Ctrl+C, an error before the stream opens), the hub it started goes with it,
// desks and all, so no paid session is left running. Only this hub, by its pid.
const killHub = () => {
  if (hub.exitCode !== null || hub.pid === undefined) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(hub.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(hub.pid, 'SIGTERM');
  } catch {
    // Gone already.
  }
};
process.on('exit', killHub);
process.on('SIGINT', () => {
  killHub();
  process.exit(1);
});

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch {
      // Not up yet.
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}
const tokenFile = join(home, '.worklings', 'token');
await waitFor(() => existsSync(tokenFile), 30_000, 'the token');
const token = readFileSync(tokenFile, 'utf8').trim();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
await waitFor(async () => (await fetch(`${base}/api/health`, { headers })).ok, 30_000, 'the hub');
const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

const raw = createWriteStream(join(out, 'raw.jsonl'));
let stopped = false;
let latest = null;
const answered = new Set();
const started = Date.now();

async function stopAll(reason) {
  if (stopped) return;
  stopped = true;
  clearInterval(doneCheck);
  clearTimeout(limit);
  summary.ended = reason;
  summary.endedAt = Date.now();
  writeFileSync(join(out, 'run.json'), JSON.stringify(summary, null, 2));
  try {
    await post('/api/hub/stop', {});
  } catch {
    // Already closing.
  }
  await sleep(4_000);
  // Only the process this script started, by its pid.
  if (hub.exitCode === null) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(hub.pid), '/t', '/f'], { stdio: 'ignore' });
    else hub.kill('SIGTERM');
  }
  raw.end();
  console.log(`ended: ${reason}; ${summary.frames} frames, $${summary.spend.toFixed(2)}`);
}

const { id } = await post('/api/companies', { folder: project, prompt: PROMPT, work: 'plain', launch: { model: values.model, permissionMode: 'acceptEdits' } });
summary.company = id;
// The office's own cap stops the job at it; the script stops earlier still, at `cap`.
await post(`/api/c/${encodeURIComponent(id)}/budget`, { company: cap + 1 });
console.log(`company ${id}`);

const spendOf = (c) => c.people.reduce((s, p) => s + p.cost, 0) + (c.helpers ?? []).reduce((s, h) => s + h.costUsd, 0);

async function onSnapshot(snapshot) {
  const at = Date.now();
  raw.write(`${JSON.stringify({ at, snapshot })}\n`);
  summary.frames += 1;
  latest = snapshot;
  const c = snapshot.company;
  summary.spend = Math.max(summary.spend, spendOf(c));
  if (summary.spend > cap) return stopAll(`spend reached $${summary.spend.toFixed(2)}`);
  for (const a of c.approvals) {
    if (a.answer || a.withdrawn || answered.has(a.id)) continue;
    answered.add(a.id);
    summary.approvals.push({ id: a.id, summary: a.summary, detail: a.detail, askedAt: a.askedAt });
    // A person reads it first.
    setTimeout(() => void post(`/api/c/${encodeURIComponent(id)}/approvals`, { approval: a.id, decision: 'allow', always: false }).catch((e) => console.error(e.message)), 4_000);
  }
  for (const q of c.questions) {
    if (q.answer || answered.has(q.id) || q.withdrawn) continue;
    answered.add(q.id);
    const built = existsSync(join(project, 'package.json'));
    summary.answers.push({ id: q.id, text: q.text, plainTurn: q.plainTurn === true, built, at });
    // A turn that ended before anything was built asked something: a person says go ahead.
    if (!(q.plainTurn && built)) setTimeout(() => void post(`/api/c/${encodeURIComponent(id)}/answers`, { question: q.id, option: null, text: 'Go ahead with your own picks.' }).catch((e) => console.error(e.message)), 4_000);
  }
  lastMove = at;
}

/** Done: the last turn's words wait in the inbox, no helper works, the session's desk is idle and nothing moved for 25 s. */
let lastMove = Date.now();
const doneCheck = setInterval(() => {
  const c = latest?.company;
  if (!c || stopped) return;
  const words = c.questions.some((q) => q.plainTurn && !q.answer && !q.withdrawn);
  const helping = (c.helpers ?? []).some((h) => h.state === 'working');
  const working = c.people.some((p) => p.desk.state === 'working' || p.desk.state === 'starting');
  if (words && !helping && !working && Date.now() - lastMove > 25_000) {
    clearInterval(doneCheck);
    void stopAll('done');
  }
}, 2_000);

const limit = setTimeout(() => void stopAll('time limit'), Number(values.minutes) * 60_000);

// The company's stream, as the browser reads it.
const res = await fetch(`${base}/events/c/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { headers: { accept: 'text/event-stream' } });
if (!res.ok || !res.body) throw new Error(`The stream answered ${res.status}.`);
const decoder = new TextDecoder();
let buffer = '';
try {
  for await (const chunk of res.body) {
    if (stopped) break;
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      if (event === 'snapshot' && data) await onSnapshot(JSON.parse(data));
    }
  }
} catch (error) {
  if (!stopped) console.error(`stream: ${error instanceof Error ? error.message : error}`);
}
await stopAll(stopped ? summary.ended : 'stream closed');
console.log(`${Math.round((Date.now() - started) / 1000)} s; the project is in ${project}`);
process.exit(0);
