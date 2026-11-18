// v0.9's packs bench (SPEC-v0.9.md, "How each pack is measured"), end to end and resumable: for each round, group and
// task, the plain arm and each pack's arm one after the other (run-plain.mjs, the pack added by Worklings' own installer),
// plain first in odd rounds and last in even ones; then every arm scored against the hidden tests (score.mjs) and each
// pack arm judged blind against the round's plain arm in both orders (review-pair.mjs). A step whose output exists is
// skipped, so a stopped bench picks up where it was.
//
//   node scripts/bench/packs-all.mjs <out> [group ...]
//
// Groups: kickoff (short requests and the stand-in who knows the full one), checks (check before done and the review
// round, sharing each round's plain arm). Environment: BENCH_ROOT and the runners' own; BENCH_ROUNDS (2); BENCH_CAP_USD
// (47), the spend under <out>'s parent folder (probes included) at which no new run or judge starts; BENCH_MINUTES (25).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { die, REPO } from './lib.mjs';
import { GROUPS, spentUnder } from './packs-lib.mjs';

const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) die('Say where the bench goes.');
const ROUNDS = Number(process.env.BENCH_ROUNDS) > 0 ? Number(process.env.BENCH_ROUNDS) : 2;
const CAP = Number(process.env.BENCH_CAP_USD) > 0 ? Number(process.env.BENCH_CAP_USD) : 47;
const bench = (name) => join(REPO, 'scripts', 'bench', name);

const chosen = process.argv.slice(3).length > 0 ? process.argv.slice(3) : Object.keys(GROUPS);

function run(script, args, env, log) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [bench(script), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, BENCH_MINUTES: process.env.BENCH_MINUTES || '25', ...env } });
    let text = '';
    child.stdout.on('data', (c) => (text += c));
    child.stderr.on('data', (c) => (text += c));
    child.on('close', (code) => {
      console.log(`  ${log}: ${text.trim().split('\n').at(-1) ?? ''} (exit ${code})`);
      done(code);
    });
  });
}

function capReached(what) {
  const now = spentUnder(dirname(out));
  if (now < CAP) return false;
  console.log(`stop: $${now.toFixed(2)} spent, at the cap of $${CAP}; ${what} not started`);
  return true;
}

for (let round = 1; round <= ROUNDS; round++) {
  for (const name of chosen) {
    const group = GROUPS[name];
    if (!group) die(`No group ${name}: ${Object.keys(GROUPS).join(', ')}.`);
    for (const task of group.tasks) {
      const dir = join(out, name, task, `r${round}`);
      const arms = Object.keys(group.arms).filter((arm) => !group.only?.[arm] || group.only[arm].includes(task));
      const order = round % 2 === 1 ? arms : [...arms.slice(1), arms[0]];
      console.log(`${name} ${task} round ${round} ($${spentUnder(dirname(out)).toFixed(2)} spent so far)`);
      for (const arm of order) {
        const at = join(dir, arm);
        if (existsSync(join(at, 'result.json'))) continue;
        if (capReached(`${name} ${task} r${round} ${arm}`)) process.exit(3);
        await run('run-plain.mjs', [task, at], { ...group.run, BENCH_PACKS: group.arms[arm] }, arm);
      }
      for (const arm of arms) {
        const at = join(dir, arm);
        if (existsSync(join(at, 'result.json')) && !existsSync(join(at, 'score.json'))) await run('score.mjs', [task, at], {}, `score ${arm}`);
      }
      for (const arm of arms.filter((a) => a !== 'plain')) {
        const judge = join(dir, `judge-${arm}`);
        if (!existsSync(join(dir, 'plain', 'result.json')) || !existsSync(join(dir, arm, 'result.json')) || existsSync(join(judge, 'pair.json'))) continue;
        if (capReached(`the judge of ${name} ${task} r${round} ${arm}`)) process.exit(3);
        await run('review-pair.mjs', [task, join(dir, 'plain'), join(dir, arm), judge], group.judge, `judge ${arm}`);
      }
    }
  }
}
console.log(`done: $${spentUnder(dirname(out)).toFixed(2)} spent`);
