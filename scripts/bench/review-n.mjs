// A blind expert review of two or more projects built for the same task, by different arms (review.mjs, for any number).
//
//   node scripts/bench/review-n.mjs <task> [<label>=]<out>... --save <folder>
//
// Each <out> is a folder a run saved (result.json, project/); the arm comes from its result.json, or from the label
// given before it (B0=<out> B1=<out> to review two versions of the company side by side), and each arm may appear once. For each round the projects are copied into a fresh neutral temp folder as solution-1 ... solution-N
// (leaving out what could name the arm or Worklings, as review.mjs does), and ONE `claude -p` session reviews all of
// them against the task's goal on the same rubric (review-schema.mjs's criteria), with scores from 1 to 10, a line of
// reasons for each, and which solution it would ship. The order rotates so that over N rounds every arm is shown in
// every position once (a Latin square, starting from a random rotation); the scores are un-blinded and averaged.
//
// Environment: as review.mjs (BENCH_ROOT, BENCH_REVIEW_MODEL default opus, BENCH_REVIEW_ROUNDS default N,
// BENCH_REVIEW_MINUTES default 30, BENCH_REVIEW_BUDGET, BENCH_REVIEW_PERMISSION, BENCH_REVIEW_CLAUDE, BENCH_FORCE).
// BENCH_REVIEW_FIRST=<n> fixes the starting rotation (0 to N-1).
//
// Saves <save>/review.json (the un-blinded result) and round-<n>.json. Exit code 1 when no round gave a valid review.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { copyTree, die, goalOf, now, readJson, removeTree, requireTask, runLogged, soloEnv, writeJson } from './lib.mjs';
import { NO_KILL_RULES } from './kill-guard.mjs';
import { CRITERIA, extractJson, KEYS, mean } from './review-schema.mjs';

const args = process.argv.slice(2);
const saveAt = args.indexOf('--save');
const saveDir = saveAt >= 0 ? resolve(args[saveAt + 1] ?? '') : null;
const positional = args.filter((_, i) => i !== saveAt && i !== saveAt + 1);
const task = requireTask(positional[0]);
// An <out> may carry a label, `<label>=<folder>`, to tell apart runs of the same arm (B0=... B1=... for two versions of
// the company); without one, the arm is the run's own.
const outs = positional.slice(1).map((p) => {
  const m = /^([A-Za-z][\w.-]{0,15})=(.+)$/.exec(p);
  return m ? { label: m[1], dir: resolve(m[2]) } : { label: null, dir: resolve(p) };
});
if (outs.length < 2 || !saveDir) die('Usage: review-n.mjs <task> [<label>=]<out1> [<label>=]<out2> [...] --save <folder>');

const projects = {};
const runDirs = {};
for (const { label, dir } of outs) {
  const r = existsSync(join(dir, 'result.json')) ? readJson(join(dir, 'result.json')) : null;
  if (!r) die(`${dir} has no result.json.`);
  if (r.task !== task) die(`${dir} is task ${r.task}, not ${task}.`);
  const arm = label ?? r.arm;
  if (projects[arm]) die(`Arm ${arm} is given twice: name the runs apart with <label>=<folder>.`);
  if (!existsSync(join(dir, 'project'))) die(`No project to review: expected ${join(dir, 'project')}.`);
  projects[arm] = join(dir, 'project');
  runDirs[arm] = dir;
}
const ARMS = Object.keys(projects);
const N = ARMS.length;
const SOLUTIONS = Array.from({ length: N }, (_, i) => `solution-${i + 1}`);
const REVIEW_MODEL = process.env.BENCH_REVIEW_MODEL || 'opus';
const ROUNDS = Number(process.env.BENCH_REVIEW_ROUNDS) >= 1 ? Math.floor(Number(process.env.BENCH_REVIEW_ROUNDS)) : N;
const ROUND_MINUTES = Number(process.env.BENCH_REVIEW_MINUTES) > 0 ? Number(process.env.BENCH_REVIEW_MINUTES) : 30;

if (existsSync(join(saveDir, 'review.json')) && process.env.BENCH_FORCE !== '1') die(`${join(saveDir, 'review.json')} exists already. Set BENCH_FORCE=1 to overwrite.`);
mkdirSync(saveDir, { recursive: true });

const HIDE = new Set(['node_modules', 'dist', 'dist-test', 'build', 'coverage', '.git', '.worklings', '.worklings-shared', '.claude', 'CLAUDE.md', 'claude.md', 'AGENTS.md', '.DS_Store', 'test-results', 'playwright-report']);
const LEAK = /worklings|headcount|\.claude\b|CLAUDE\.md|\bone[- ]prompt\b|\bbenchmark\b|\bsubagent/i;

function schema() {
  const score = { type: 'integer', minimum: 1, maximum: 10 };
  const scores = { type: 'object', additionalProperties: false, required: KEYS, properties: Object.fromEntries(KEYS.map((k) => [k, k === 'ux' ? { type: ['integer', 'null'], minimum: 1, maximum: 10 } : score])) };
  const notes = { type: 'object', additionalProperties: false, required: KEYS, properties: Object.fromEntries(KEYS.map((k) => [k, { type: 'string' }])) };
  const one = { type: 'object', additionalProperties: false, required: ['scores', 'notes'], properties: { scores, notes } };
  return {
    type: 'object', additionalProperties: false, required: ['solutions', 'ship'],
    properties: {
      solutions: { type: 'object', additionalProperties: false, required: SOLUTIONS, properties: Object.fromEntries(SOLUTIONS.map((s) => [s, one])) },
      ship: { type: 'object', additionalProperties: false, required: ['choice', 'why'], properties: { choice: { enum: [...SOLUTIONS, 'neither'] }, why: { type: 'string' } } },
    },
  };
}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function validate(value) {
  const problems = [];
  if (!isObj(value) || !isObj(value.solutions)) return ['"solutions" is missing'];
  for (const s of SOLUTIONS) {
    const sol = value.solutions[s];
    if (!isObj(sol)) {
      problems.push(`"solutions.${s}" is missing`);
      continue;
    }
    for (const k of KEYS) {
      const v = sol.scores?.[k];
      if (!(k === 'ux' && v === null) && !(typeof v === 'number' && v >= 1 && v <= 10)) problems.push(`"solutions.${s}.scores.${k}" must be 1 to 10`);
      if (typeof sol.notes?.[k] !== 'string') problems.push(`"solutions.${s}.notes.${k}" must be a string`);
    }
  }
  if (!isObj(value.ship) || ![...SOLUTIONS, 'neither'].includes(value.ship.choice) || typeof value.ship.why !== 'string') problems.push('"ship" must name a solution or "neither", with "why"');
  return problems;
}

const goal = goalOf(task);
const words = ['', '', 'two', 'three', 'four', 'five'];
const list = SOLUTIONS.map((s) => `./${s}`).join(', ');
const prompt = `You are a senior engineer reviewing ${words[N] ?? N} independent solutions to the same goal. You do not know who or what made them; judge only what is in front of you.

THE GOAL
${goal}

THE SOLUTIONS
They are in the folders ${list} of your working folder. Review each against the goal, with the same care.

HOW TO REVIEW
- Read the code, the tests and the documentation of each solution.
- You may install, build and run the tests and the program of each solution, with Bash, from inside that solution's folder only (cd into it first). Do not change any file, do not read or write outside the solution folders, and do not use the network except for npm installing a solution's own dependencies.
- Prefer evidence to impressions: run it on realistic inputs and on edge cases you think of from the goal (empty and malformed input, errors, unusual cases), and see what happens. For a UI, judge from the code and from what you can run; say so in the notes when you could not run it.
- Judge the outcome only: how it was made is not your concern, and size or polish for its own sake earns nothing. A solution that is shorter and correct beats a longer one with gaps.

THE RUBRIC
Score each solution from 1 to 10 on every criterion (10: you would be glad to ship it as is; 7: good with small gaps; 5: works for the main case but with real gaps; 3: major problems; 1: does not work). Use the whole range and do not give solutions the same score unless they really are equal. Give a one-line reason for every score. Criteria:
${CRITERIA.map((c) => `- ${c.key} (${c.label}): ${c.ask}.`).join('\n')}
"ux" may be null only when the criterion cannot apply at all; for a command line tool it is the usability of its output, errors and usage.
Then say which one solution you would ship and why, in one or two sentences ("neither" only if none is shippable).

YOUR ANSWER
Your final message must be ONLY one JSON object that follows this JSON Schema, with no text before or after it:
${JSON.stringify(schema())}
`;

function place(from, folder, name) {
  const to = join(folder, name);
  copyTree(from, to, { skip: HIDE });
  const leaks = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && statSync(p).size < 1_000_000 && !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|lock)$/i.test(entry.name)) {
        const text = readFileSync(p, 'utf8');
        if (!text.includes('\u0000') && LEAK.test(text)) leaks.push(p.slice(to.length + 1).replaceAll('\\', '/'));
      }
    }
  };
  walk(to);
  return leaks;
}

function readOutput(file) {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { text: raw, structured: null, costUsd: null, subtype: null };
  }
  const final = Array.isArray(doc) ? [...doc].reverse().find((l) => l?.type === 'result') : doc;
  return { text: typeof final?.result === 'string' ? final.result : '', structured: final?.structured_output ?? null, costUsd: typeof final?.total_cost_usd === 'number' ? final.total_cost_usd : null, subtype: final?.subtype ?? null };
}

const exe = process.env.BENCH_REVIEW_CLAUDE || process.env.WORKLINGS_CLAUDE || '';
const [command, lead] = !exe ? ['claude', []] : /\.(mjs|cjs|js|ts)$/i.test(exe) ? [process.execPath, [exe]] : [exe, []];
const fake = Boolean(exe);
const env = await soloEnv();
const start = /^\d+$/.test(process.env.BENCH_REVIEW_FIRST ?? '') ? Number(process.env.BENCH_REVIEW_FIRST) % N : Math.floor(Math.random() * N);
const blindnessLeaks = {};
const rounds = [];
console.log(`review of ${task} (${ARMS.join(', ')}): ${fake ? `FAKE claude (${exe})` : 'REAL claude'}, model ${REVIEW_MODEL}, ${ROUNDS} round(s), saving to ${saveDir}`);

for (let n = 1; n <= ROUNDS; n += 1) {
  const order = Object.fromEntries(SOLUTIONS.map((s, i) => [s, ARMS[(i + start + n - 1) % N]]));
  const folder = mkdtempSync(join(tmpdir(), 'review-'));
  const outFile = join(tmpdir(), `${basename(folder)}.output.json`);
  const errFile = join(tmpdir(), `${basename(folder)}.stderr.txt`);
  const startedAt = now();
  try {
    for (const s of SOLUTIONS) {
      const leaks = place(projects[order[s]], folder, s);
      if (leaks.length > 0) blindnessLeaks[order[s]] = [...new Set([...(blindnessLeaks[order[s]] ?? []), ...leaks])];
    }
    const cli = [
      ...lead, '-p', '--model', REVIEW_MODEL, '--output-format', 'json', '--json-schema', JSON.stringify(schema()),
      '--permission-mode', process.env.BENCH_REVIEW_PERMISSION || 'dontAsk',
      '--allowedTools', 'Bash', 'Read', 'Grep', 'Glob',
      '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'mcp__*', ...NO_KILL_RULES,
      '--no-session-persistence', '--settings', '{"disableAllHooks":true}',
    ];
    if (Number(process.env.BENCH_REVIEW_BUDGET) > 0) cli.push('--max-budget-usd', String(Number(process.env.BENCH_REVIEW_BUDGET)));
    console.log(`round ${n}: reviewing (the order is recorded and kept private until the scores are in)`);
    const ran = await runLogged(command, cli, { cwd: folder, env, input: prompt, stdoutFile: outFile, stderrFile: errFile, timeoutMs: ROUND_MINUTES * 60_000 });
    await new Promise((done) => setTimeout(done, 300));
    const out = readOutput(outFile);
    const answer = out.structured && typeof out.structured === 'object' ? out.structured : extractJson(out.text);
    const problems = ran.timedOut ? [`timed out after ${ROUND_MINUTES} min`] : answer ? validate(answer) : ['no JSON object in the reply'];
    const round = { round: n, order, ok: problems.length === 0, problems, wallMs: now() - startedAt, costUsd: out.costUsd, exitCode: ran.code, subtype: out.subtype };
    if (round.ok) {
      const of = (arm) => answer.solutions[SOLUTIONS.find((s) => order[s] === arm)];
      round.scores = Object.fromEntries(ARMS.map((a) => [a, of(a).scores]));
      round.notes = Object.fromEntries(ARMS.map((a) => [a, of(a).notes]));
      round.ship = { choice: answer.ship.choice === 'neither' ? 'neither' : order[answer.ship.choice], position: answer.ship.choice, why: answer.ship.why };
    } else round.rawReply = out.text.slice(0, 4000);
    rounds.push(round);
    writeJson(join(saveDir, `round-${n}.json`), round);
    const cost = out.costUsd === null ? 'cost unknown' : `$${out.costUsd.toFixed(2)}`;
    console.log(round.ok ? `round ${n}: ${SOLUTIONS.map((s) => `${s}=${order[s]}`).join(' ')}; overall ${ARMS.map((a) => `${a} ${round.scores[a].overall}`).join(', ')}; would ship ${round.ship.choice} (${(round.wallMs / 1000).toFixed(0)} s, ${cost})` : `round ${n}: no valid review (${problems.join('; ')})`);
  } finally {
    removeTree(folder);
    removeTree(outFile);
    removeTree(errFile);
  }
}

const good = rounds.filter((r) => r.ok);
const ship = Object.fromEntries([...ARMS, 'neither'].map((a) => [a, good.filter((r) => r.ship.choice === a).length]));
const shipByPosition = Object.fromEntries([...SOLUTIONS, 'neither'].map((s) => [s, good.filter((r) => r.ship.position === s).length]));
const costs = rounds.map((r) => r.costUsd);
const review = {
  task, arms: ARMS, reviewedAt: new Date().toISOString(), dryRun: fake, model: REVIEW_MODEL, rounds: rounds.length, validRounds: good.length,
  mean: Object.fromEntries(ARMS.map((a) => [a, Object.fromEntries(KEYS.map((k) => [k, mean(good.map((r) => r.scores[a][k]))]))])),
  ship, shipByPosition,
  // The reviewer agrees with itself when one arm wins every round, whatever the order.
  unanimous: good.length >= 2 && new Set(good.map((r) => r.ship.choice)).size === 1,
  blindnessLeaks, costUsd: costs.every((c) => typeof c === 'number') ? costs.reduce((a, c) => a + c, 0) : null,
  runs: runDirs,
  roundResults: rounds,
};
writeJson(join(saveDir, 'review.json'), review);
if (Object.keys(blindnessLeaks).length > 0) console.warn(`WARNING: files that may name an arm were shown to the reviewer: ${JSON.stringify(blindnessLeaks)}`);
console.log(good.length === 0 ? 'no valid review' : `mean overall: ${ARMS.map((a) => `${a} ${review.mean[a].overall?.toFixed(1)}`).join(', ')}; would ship ${ARMS.map((a) => `${a} ${ship[a]}`).join(', ')}, neither ${ship.neither} of ${good.length}`);
process.exit(good.length === 0 ? 1 : 0);
