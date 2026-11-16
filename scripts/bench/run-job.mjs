// v0.7's Worklings arm: the goal as a job in a throwaway hub with Worklings' defaults (a plain company), through the
// bench's profile, driven through the hub's own HTTP API as the browser would.
//
//   node scripts/bench/run-job.mjs <task> <out>
//
// `worklings new <folder> --prompt <goal> --model <BENCH_MODEL> --permission-mode <BENCH_PERMISSION>` in a hub with its
// own WORKLINGS_HOME and a free port, WORKLINGS_CLAUDE pointing at profile-claude.mjs. The job runs until the session ends
// its turn (its words wait in the inbox). Prompts are treated as plain `claude -p` treats them: a permission prompt is
// denied (a headless session has nobody to ask), and counted; end-of-turn questions get ANSWER once when answers are on.
//
// Environment: as run-plain.mjs, plus BENCH_PRODUCT (a frozen copy of the Worklings to run; result.json records its
// commit) and WORKLINGS_CLAUDE_REAL (unused; the real Claude Code is `claude` on the PATH, or BENCH_REAL_CLAUDE).
//
// Saves to <out>: result.json, events.jsonl (what the harness did), state.json (the job's last snapshot), hub.log,
// project/ (the folder, without node_modules and without the office's .worklings records) and goal.txt.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTree, environment, freePort, goalOf, killTree, leftovers, stopRecorded, watchTree, MINUTES, MODEL, now, outDir, prepareStart, PRODUCT, REPO, removeTree, requireTask, sh, sleep, tail, writeJson } from './lib.mjs';
import { ANSWER, ANSWERS, asksQuestions, PERMISSION, PROFILE, PROFILE_CLAUDE } from './parity-lib.mjs';

const task = requireTask(process.argv[2]);
const out = outDir(process.argv[3], 'result.json');
const goal = goalOf(task);
writeFileSync(join(out, 'goal.txt'), `${goal}\n`);
const events = join(out, 'events.jsonl');
const note = (kind, detail = {}) => appendFileSync(events, `${JSON.stringify({ at: new Date().toISOString(), kind, ...detail })}\n`);
const POLL_MS = 1_000;
/** How long the job must stay still at a turn's end (no desk at work, no helper at work) before it counts as ended. */
const QUIET_MS = 5_000;
let quietSince = null;

const folder = prepareStart(task, 'bench-w');
const home = mkdtempSync(join(tmpdir(), 'bench-w-home-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, WORKLINGS_HOME: home, WORKLINGS_CLAUDE: PROFILE_CLAUDE, BENCH_PROFILE: PROFILE, BENCH_PROFILE_LOG: join(out, 'launches.jsonl') };
delete env.CLAUDECODE;
delete env.ANTHROPIC_MODEL;
console.log(`Worklings arm, ${task}: a job in ${folder}; hub on port ${port}; profile ${PROFILE}, model ${MODEL}, mode ${PERMISSION}, cap ${MINUTES} min`);

const startedAt = now();
const hubLog = join(out, 'hub.log');
writeFileSync(hubLog, '');
// BENCH_PLAN_FIRST=1 and BENCH_APPROVE=allow are for checking the product's pass-through, never for the parity bench.
const PLAN_FIRST = process.env.BENCH_PLAN_FIRST === '1';
const APPROVE = process.env.BENCH_APPROVE === 'allow' ? 'allow' : 'deny';
const hub = spawn(process.execPath, [join(PRODUCT, 'src', 'cli.ts'), 'new', folder, '--prompt', goal, '--model', MODEL, ...(PLAN_FIRST ? ['--plan-first'] : ['--permission-mode', PERMISSION]), '--port', String(port), '--no-open'], {
  cwd: PRODUCT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
const hubPid = hub.pid;
// Everything the hub and its desk start, recorded while it runs, so what a session leaves running is stopped afterwards.
const tree = watchTree(hubPid);
let hubExited = false;
hub.on('close', (code) => {
  hubExited = true;
  note('hub-exited', { code });
});
hub.stdout.on('data', (c) => appendFileSync(hubLog, c));
hub.stderr.on('data', (c) => appendFileSync(hubLog, c));
note('hub-started', { pid: hubPid, port });

let token = null;
const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body: json, text };
};

const productCommit = existsSync(join(PRODUCT, 'PRODUCT_COMMIT'))
  ? readFileSync(join(PRODUCT, 'PRODUCT_COMMIT'), 'utf8').trim()
  : `${sh('git', ['rev-parse', '--short', 'HEAD'], { cwd: PRODUCT, timeoutMs: 20_000 }).stdout.trim()}${sh('git', ['status', '--porcelain', '--', 'src'], { cwd: PRODUCT, timeoutMs: 20_000 }).stdout.trim() ? ' (with uncommitted changes)' : ''}`;
const capAt = startedAt + MINUTES * 60_000;
const prompts = { permissionDenied: 0, questionsAnswered: 0 };
let companyId = null;
let company = null;
let snapshot = null;
let failure = null;
let capped = false;
let firstTurnAt = null;
let endedAt = null;
const answered = new Set();
const decided = new Set();

async function look() {
  const r = await call('GET', `/api/c/${companyId}/state`).catch(() => null);
  if (!r || r.status !== 200 || !r.body?.company) return null;
  snapshot = r.body;
  company = r.body.company;
  return company;
}

try {
  const tokenFile = join(home, '.worklings', 'token');
  while (companyId === null) {
    if (hubExited) throw new Error(`the hub exited before a job showed. Hub output:\n${tail(readFileSync(hubLog, 'utf8'), 20)}`);
    if (now() > startedAt + 120_000) throw new Error('the hub never showed a job');
    if (!token && existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
    if (token) companyId = (await call('GET', '/api/lobby').catch(() => null))?.body?.companies?.[0]?.id ?? null;
    if (companyId === null) await sleep(500);
  }
  note('job-founded', { id: companyId });
  for (;;) {
    if (hubExited) throw new Error('the hub exited during the job');
    if (now() > capAt) {
      capped = true;
      break;
    }
    const c = await look();
    if (c) {
      firstTurnAt ??= c.messages?.find((m) => m.from === '@stakeholder' && m.deliveredAt)?.deliveredAt ?? null;
      for (const a of (c.approvals ?? []).filter((x) => !x.answer && !x.withdrawn && !decided.has(x.id))) {
        decided.add(a.id);
        // Plain claude -p has nobody to ask, so the prompt is a no; the job carries on as that session would.
        const r = await call('POST', `/api/c/${companyId}/approvals`, APPROVE === 'allow' ? { approval: a.id, decision: 'allow' } : { approval: a.id, decision: 'deny', note: 'Nobody can answer prompts in this run.' });
        if (APPROVE === 'allow') prompts.permissionAllowed = (prompts.permissionAllowed ?? 0) + 1;
        else prompts.permissionDenied += 1;
        note(`approval-${APPROVE === 'allow' ? 'allowed' : 'denied'}`, { id: a.id, tool: a.tool, summary: a.summary, detail: String(a.detail ?? '').slice(0, 400), status: r.status });
      }
      const person = c.people?.[0];
      // A turn that ends while a background subagent still works isn't the end: its notification starts another turn.
      const working = (person && ['starting', 'working', 'waiting', 'stopping'].includes(person.desk?.state)) || (c.helpers ?? []).some((h) => h.state === 'working');
      const waiting = (c.questions ?? []).filter((q) => q.plainTurn === true && !q.answer && !q.withdrawn && !answered.has(q.id));
      if (waiting.length > 0 && !working && quietSince === null) quietSince = now();
      if (working || waiting.length === 0) quietSince = null;
      if (waiting.length > 0 && !working && now() - quietSince >= QUIET_MS) {
        const q = waiting.at(-1);
        endedAt = quietSince;
        if (ANSWERS && prompts.questionsAnswered === 0 && asksQuestions(q.text)) {
          const r = await call('POST', `/api/c/${companyId}/answers`, { question: q.id, text: ANSWER });
          answered.add(q.id);
          prompts.questionsAnswered += 1;
          note('question-answered', { id: q.id, text: String(q.text).slice(0, 1500), status: r.status });
          endedAt = null;
        } else {
          note('turn-ended', { id: q.id, text: String(q.text).slice(0, 1500) });
          break;
        }
      }
    }
    await sleep(POLL_MS);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  note('failure', { failure });
}

const wallMs = (endedAt ?? now()) - startedAt;
await look().catch(() => null);
if (snapshot) writeJson(join(out, 'state.json'), snapshot);
tree.read();
killTree(hubPid);
for (let i = 0; i < 60 && !hubExited; i++) await sleep(500);
const stoppedAfter = stopRecorded(tree.stop());
const stray = leftovers(folder);
copyTree(folder, join(out, 'project'), { skip: new Set(['node_modules', '.worklings']) });
const removed = removeTree(folder);
removeTree(home);
const people = company?.people ?? [];
const costUsd = people.reduce((sum, p) => sum + (typeof p.cost === 'number' ? p.cost : 0), 0);
const result = {
  task, arm: 'W', profile: PROFILE, model: MODEL, permission: PERMISSION, effort: 'Claude Code default', startedAt: new Date(startedAt).toISOString(), wallMs,
  deskMs: firstTurnAt && endedAt ? endedAt - firstTurnAt : null, capped, failure, costUsd, prompts,
  helpers: (company?.helpers ?? []).map((h) => ({ type: h.type, description: h.description, state: h.state, costUsd: h.costUsd })),
  todos: company?.todos?.length ?? 0,
  lastWords: company?.questions?.filter((q) => q.plainTurn).at(-1)?.text?.slice(0, 2000) ?? null,
  done: !failure && !capped && endedAt !== null,
  product: { frozen: PRODUCT !== REPO, commit: productCommit },
  leftoverProcesses: stray, stoppedAfter, tempFolderRemoved: removed, env: environment(),
};
writeJson(join(out, 'result.json'), result);
console.log(`done in ${(wallMs / 1000).toFixed(1)} s, $${costUsd.toFixed(4)}, prompts ${JSON.stringify(prompts)}, failure ${failure ?? 'none'}`);
process.exit(failure ? 1 : 0);
