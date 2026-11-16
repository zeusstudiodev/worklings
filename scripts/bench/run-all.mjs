// The whole benchmark in one command: every task, arm and repeat, each run scored, each repeat reviewed blind, then the
// report. Resumable: a run, score or review that is already saved is kept, so the same command picks up where it stopped.
//
//   node scripts/bench/run-all.mjs --out <folder> [--tasks a,b] [--arms A,P,B] [--repeats 3] [--parallel 2] [--dry]
//                                  [--no-review] [--plan]
//
// Arms: A one `claude -p` session (run-a.mjs); P one session that plans first and builds with its own subagents
// (run-p.mjs); B a Worklings company (run-b.mjs). Layout under --out: runs/<task>/<arm>-<n>/ (each arm's folder),
// reviews/<task>/r<n>/ (review-n.mjs across the arms of repeat n), report.md and summary.json (report-n.mjs), log.txt.
//
// Scheduling: at most --parallel jobs at once (default 2), and never two companies at once, so one company's desks are
// the only many-session load at any moment. Repeats go round by round (every task's first repeat before any second),
// so a run stopped early still has balanced results. The arm order turns from task to task.
//
// --dry runs everything with Claude Code faked (fake-solo.mjs for A and P, test/fake-desk.mjs playing a scripted company
// for B, fake-reviewer-n.mjs for the reviews): free, a few minutes, low scores on purpose. --plan prints the jobs and
// stops. Every real run keeps the kill guard (kill-guard.mjs): no run can stop programs by name across the computer.
// A file named PAUSE in --out holds new jobs back until it is deleted (a budget check between runs, say).
//
// Environment: BENCH_ROOT (where the tasks live), BENCH_MODEL (default sonnet), BENCH_REVIEW_MODEL (default opus),
// BENCH_MINUTES (cap per run, default 45), BENCH_DESKS (desks at once for B, default 8, the product's default),
// BENCH_SKIP_SCORE=1 (build now, score on a later run of the same command).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BENCH_ROOT, die, REPO, TASKS } from './lib.mjs';
import { deskScript } from './dry-desk-script.mjs';

const here = (file) => fileURLToPath(new URL(`./${file}`, import.meta.url));
const { values: opt } = parseArgs({
  options: {
    out: { type: 'string' }, tasks: { type: 'string' }, arms: { type: 'string' }, repeats: { type: 'string' }, parallel: { type: 'string' },
    dry: { type: 'boolean' }, 'no-review': { type: 'boolean' }, plan: { type: 'boolean' },
  },
});
if (!opt.out) die('Say where to save everything: --out <folder>.');
const out = resolve(opt.out);
const tasks = opt.tasks ? opt.tasks.split(',').map((t) => t.trim()) : TASKS;
for (const t of tasks) if (!TASKS.includes(t)) die(`Unknown task ${t}: ${TASKS.join(', ')} (BENCH_ROOT=${BENCH_ROOT}).`);
const arms = (opt.arms ?? 'A,P,B').split(',').map((a) => a.trim().toUpperCase());
for (const a of arms) if (!['A', 'P', 'B'].includes(a)) die(`Unknown arm ${a}: A, P or B.`);
const repeats = Number(opt.repeats ?? 3);
const parallel = Math.max(1, Number(opt.parallel ?? 2));
const RUNNER = { A: 'run-a.mjs', P: 'run-p.mjs', B: 'run-b.mjs' };
mkdirSync(out, { recursive: true });
const logFile = join(out, 'log.txt');
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(logFile, `${text}\n`);
};

// --- the environment each kind of job gets --------------------------------------------------------------------------
const base = { ...process.env, BENCH_ROOT, BENCH_DESKS: process.env.BENCH_DESKS || '8' };
delete base.CLAUDECODE;
const fakes = {};
if (opt.dry) {
  const script = join(out, 'dry-desk-script.json');
  writeFileSync(script, JSON.stringify(deskScript()));
  Object.assign(base, { BENCH_MINUTES: process.env.BENCH_MINUTES || '4', BENCH_QUIET_S: '8', FAKE_DESK_SCRIPT: script, FAKE_DESK_SESSIONS: join(out, 'dry-desk-sessions'), FAKE_DESK_LOG: join(out, 'dry-desk.jsonl') });
  fakes.A = join(REPO, 'scripts', 'bench', 'fake-solo.mjs');
  fakes.P = fakes.A;
  fakes.B = join(REPO, 'test', 'fake-desk.mjs');
  fakes.review = here('fake-reviewer-n.mjs');
} else {
  for (const key of ['WORKLINGS_CLAUDE', 'BENCH_REVIEW_CLAUDE', 'FAKE_DESK_SCRIPT']) delete base[key];
}
const envFor = (kind) => (opt.dry ? { ...base, ...(kind === 'review' ? { BENCH_REVIEW_CLAUDE: fakes.review } : { WORKLINGS_CLAUDE: fakes[kind] }) } : base);

// --- the jobs ---------------------------------------------------------------------------------------------------------
const runDir = (task, arm, n) => join(out, 'runs', task, `${arm}-${n}`);
const reviewDir = (task, n) => join(out, 'reviews', task, `r${n}`);
const jobs = [];
for (let n = 1; n <= repeats; n += 1) {
  tasks.forEach((task, i) => {
    const order = arms.map((_, k) => arms[(k + i + n) % arms.length]);
    for (const arm of order) jobs.push({ id: `${task}/${arm}-${n}`, kind: 'run', task, arm, n, dir: runDir(task, arm, n) });
    if (!opt['no-review'] && arms.length >= 2) jobs.push({ id: `${task}/review-${n}`, kind: 'review', task, n, dir: reviewDir(task, n), after: arms.map((a) => `${task}/${a}-${n}`) });
  });
}
if (opt.plan) {
  for (const j of jobs) console.log(`${j.id}${j.after ? ` (after ${j.after.join(', ')})` : ''}`);
  console.log(`${jobs.length} jobs, ${parallel} at a time, ${opt.dry ? 'dry' : 'REAL'}; saving to ${out}`);
  process.exit(0);
}

const finished = new Set();
const failed = new Set();
const running = new Map();

function spawnNode(args, env, logName) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const file = join(out, 'logs', `${logName}.txt`);
    mkdirSync(join(out, 'logs'), { recursive: true });
    child.stdout.on('data', (c) => appendFileSync(file, c));
    child.stderr.on('data', (c) => appendFileSync(file, c));
    child.on('close', (code) => done(code ?? 1));
    child.on('error', () => done(1));
  });
}

async function runJob(job) {
  if (job.kind === 'run') {
    if (!existsSync(join(job.dir, 'result.json'))) {
      const code = await spawnNode([here(RUNNER[job.arm]), job.task, job.dir], envFor(job.arm), job.id.replace('/', '_'));
      if (!existsSync(join(job.dir, 'result.json'))) return `the run left no result (exit ${code})`;
      stopLeftovers(job);
    }
    // BENCH_SKIP_SCORE=1 builds now and scores on a later rerun (scoring installs, builds and drives browsers).
    if (!existsSync(join(job.dir, 'score.json')) && process.env.BENCH_SKIP_SCORE !== '1') {
      const code = await spawnNode([here('score.mjs'), job.task, job.dir], base, `${job.id.replace('/', '_')}_score`);
      if (!existsSync(join(job.dir, 'score.json'))) return `scoring left no score (exit ${code})`;
    }
    return null;
  }
  if (existsSync(join(job.dir, 'review.json'))) return null;
  const outs = arms.map((a) => runDir(job.task, a, job.n)).filter((d) => existsSync(join(d, 'result.json')));
  if (outs.length < 2) return 'fewer than two runs to review';
  const code = await spawnNode([here('review-n.mjs'), job.task, ...outs, '--save', job.dir], envFor('review'), job.id.replace('/', '_'));
  return existsSync(join(job.dir, 'review.json')) ? null : `the review left no result (exit ${code})`;
}

/**
 * Programs a run's own session started and left running (a dev server, a test watcher): the runners report them, and
 * with BENCH_STOP_LEFTOVERS=1 they are stopped here, each by its PID, only after checking again that its command line
 * still names the run's own temp folder (so a reused PID is never hit). Never by name, port or pattern.
 */
function stopLeftovers(job) {
  if (process.env.BENCH_STOP_LEFTOVERS !== '1' || process.platform !== 'win32') return;
  const r = JSON.parse(readFileSync(join(job.dir, 'result.json'), 'utf8'));
  // The run's temp folders are named bench-<arm>-<task>-<random> (and bench-b-home-<random> for a company's hub).
  const mine = new RegExp(`(^|[^a-z0-9])bench-(${job.arm.toLowerCase()}-${job.task}|b-home)-`, 'i');
  for (const p of r.leftoverProcesses ?? []) {
    const q = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(p.pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true });
    const cmd = q.stdout ?? '';
    if (!mine.test(cmd)) continue;
    spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    log(`stopped a leftover of ${job.id}: ${p.name} ${p.pid}`);
  }
}

/** A file named PAUSE in --out holds new jobs back (the ones running finish); removing it lets them go on. */
const paused = () => existsSync(join(out, 'PAUSE'));
let pauseNoted = false;

const ready = (job) => !running.has(job.id) && !finished.has(job.id) && !failed.has(job.id) && (job.after ?? []).every((id) => finished.has(id) || failed.has(id));
const companyRunning = () => [...running.values()].some((j) => j.kind === 'run' && j.arm === 'B');

log(`benchmark: ${tasks.length} task(s) x ${arms.join('/')} x ${repeats} repeat(s), ${parallel} at a time, ${opt.dry ? 'DRY (Claude Code faked)' : 'REAL'}; ${out}`);
await new Promise((allDone) => {
  const pump = () => {
    if (paused()) {
      if (!pauseNoted) log(`paused: ${join(out, 'PAUSE')} holds new jobs back; delete it to go on`);
      pauseNoted = true;
      setTimeout(pump, 15_000);
      return;
    }
    if (pauseNoted) log('going on');
    pauseNoted = false;
    for (const job of jobs) {
      if (running.size >= parallel) break;
      if (!ready(job)) continue;
      if (job.kind === 'run' && job.arm === 'B' && companyRunning()) continue;
      running.set(job.id, job);
      log(`start ${job.id}`);
      const started = Date.now();
      runJob(job).then(
        (problem) => {
          running.delete(job.id);
          (problem ? failed : finished).add(job.id);
          log(`${problem ? 'FAILED' : 'done'} ${job.id} in ${((Date.now() - started) / 60_000).toFixed(1)} min${problem ? `: ${problem}` : ''}`);
          pump();
        },
        (error) => {
          running.delete(job.id);
          failed.add(job.id);
          log(`FAILED ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
          pump();
        },
      );
    }
    if (running.size === 0 && jobs.every((j) => finished.has(j.id) || failed.has(j.id))) allDone();
  };
  pump();
});

log('report');
await spawnNode([here('report-n.mjs'), out], base, 'report');
log(`finished: ${finished.size} job(s) done, ${failed.size} failed${failed.size ? ` (${[...failed].join(', ')})` : ''}; report in ${join(out, 'report.md')}`);
process.exit(failed.size > 0 ? 1 : 0);
