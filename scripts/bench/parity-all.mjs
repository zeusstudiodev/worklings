// v0.7's parity bench, end to end and resumable: for each round and task, the plain arm and the Worklings arm one after
// the other (run-plain.mjs and run-job.mjs; at the same time, two apps on the same default port would meet), plain first
// in odd rounds and Worklings first in even ones, so neither always gets the warmer cache or the quieter hour; then both scored
// against the hidden tests (score.mjs) and judged blind in both orders (review-pair.mjs). A step whose output exists is
// skipped, so a stopped bench picks up where it was.
//
//   node scripts/bench/parity-all.mjs <out> [task ...]
//
// Environment: BENCH_ROOT, BENCH_PRODUCT, BENCH_PROFILE and the rest as the runners take them; BENCH_ROUNDS (2);
// BENCH_CAP_USD, the spend at which no new run starts (spent.mjs's sum of everything under <out>'s parent folder).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { die, REPO } from './lib.mjs';

const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) die('Say where the bench goes.');
const TASKS = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['feature', 'bugfix', 'refactor', 'data-script', 'multifile', 'link-checker', 'api', 'game', 'bookshop', 'household'];
const ROUNDS = Number(process.env.BENCH_ROUNDS) > 0 ? Number(process.env.BENCH_ROUNDS) : 2;
const CAP = Number(process.env.BENCH_CAP_USD) > 0 ? Number(process.env.BENCH_CAP_USD) : Infinity;
const bench = (name) => join(REPO, 'scripts', 'bench', name);

function run(script, args, log) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [bench(script), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let text = '';
    child.stdout.on('data', (c) => (text += c));
    child.stderr.on('data', (c) => (text += c));
    child.on('close', (code) => {
      console.log(`  ${log}: ${text.trim().split('\n').at(-1) ?? ''} (exit ${code})`);
      done(code);
    });
  });
}

function spent() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(dirname(out), 'spent.mjs'), dirname(out)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '';
    child.stdout.on('data', (c) => (text += c));
    child.on('close', () => done(Number(text.trim()) || 0));
  });
}

for (let round = 1; round <= ROUNDS; round++) {
  for (const task of TASKS) {
    const dir = join(out, task, `r${round}`);
    const plain = join(dir, 'plain');
    const job = join(dir, 'job');
    if (!existsSync(join(plain, 'result.json')) || !existsSync(join(job, 'result.json'))) {
      const now = await spent();
      if (now >= CAP) {
        console.log(`stop: $${now.toFixed(2)} spent, at the cap of $${CAP}; ${task} round ${round} not started`);
        process.exit(3);
      }
      console.log(`${task} round ${round} ($${now.toFixed(2)} spent so far)`);
      const order = round % 2 === 1 ? ['plain', 'job'] : ['job', 'plain'];
      for (const arm of order) {
        if (arm === 'plain' && !existsSync(join(plain, 'result.json'))) await run('run-plain.mjs', [task, plain], 'plain');
        if (arm === 'job' && !existsSync(join(job, 'result.json'))) await run('run-job.mjs', [task, job], 'job');
      }
    }
    for (const arm of [plain, job]) if (existsSync(join(arm, 'result.json')) && !existsSync(join(arm, 'score.json'))) await run('score.mjs', [task, arm], `score ${arm.endsWith('job') ? 'job' : 'plain'}`);
    if (existsSync(join(plain, 'result.json')) && existsSync(join(job, 'result.json')) && !existsSync(join(dir, 'judge', 'pair.json'))) await run('review-pair.mjs', [task, plain, job, join(dir, 'judge')], 'judge');
  }
}
console.log(`done: $${(await spent()).toFixed(2)} spent`);
