// A blind expert review of the two projects a task produced, judged on quality of the outcome first.
//
//   node scripts/bench/review.mjs <task> <outA> <outB>
//
// <outA> and <outB> are the folders run-a.mjs and run-b.mjs saved (each holds project/, the working tree it produced).
// For each round the two projects are copied into a fresh neutral temp folder as solution-1 and solution-2 (leaving out
// node_modules, build output, .git, .worklings, .claude, CLAUDE.md and AGENTS.md, so nothing names the arm or Worklings),
// and ONE `claude -p` session reviews them against the task's goal on a fixed rubric (review-schema.mjs): scores from 1
// to 10 with a line of reasons per criterion, the overall score, and which solution it would ship. The reviewer may run
// each solution's install, build and tests; it has no write tools. Round 1's order is random, round 2's is the reverse
// (and so on), the order is recorded, and the scores are un-blinded and averaged to cancel position bias.
//
// Environment:
//   BENCH_ROOT           where the tasks live (default: worklings-bench in your home folder)
//   BENCH_REVIEW_MODEL   the reviewer's model (default opus)
//   BENCH_REVIEW_ROUNDS  rounds, each with the order swapped (default 2)
//   BENCH_REVIEW_MINUTES wall-time cap per round (default 30)
//   BENCH_REVIEW_BUDGET  --max-budget-usd per round (default: none)
//   BENCH_REVIEW_FIRST   A or B: which arm is solution-1 in round 1 (default: random)
//   BENCH_REVIEW_PERMISSION  --permission-mode (default dontAsk: the allowed tools run, anything else is refused)
//   BENCH_REVIEW_CLAUDE  the executable instead of `claude` (else WORKLINGS_CLAUDE, else `claude`): a dry run sets it to
//                        scripts/bench/fake-reviewer.mjs, or the review spends money (Opus, a few dollars a round)
//   BENCH_REVIEWS        where reviews are saved (default: <runs folder>/../reviews)
//   BENCH_FORCE=1        overwrite an existing review
//
// Saves <reviews>/<task>/review.json (the un-blinded result) and round-<n>.json (what the reviewer returned, with the
// order). Exit code 1 when no round gave a valid review. Never kills anything: the reviewer's own tree on a timeout only.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { copyTree, die, goalOf, now, readJson, removeTree, requireTask, runLogged, soloEnv, writeJson } from './lib.mjs';
import { NO_KILL_RULES } from './kill-guard.mjs';
import { CRITERIA, extractJson, KEYS, mean, reviewSchema, SOLUTIONS, validateReview } from './review-schema.mjs';

const REVIEW_MODEL = process.env.BENCH_REVIEW_MODEL || 'opus';
const ROUNDS = Number(process.env.BENCH_REVIEW_ROUNDS) >= 1 ? Math.floor(Number(process.env.BENCH_REVIEW_ROUNDS)) : 2;
const ROUND_MINUTES = Number(process.env.BENCH_REVIEW_MINUTES) > 0 ? Number(process.env.BENCH_REVIEW_MINUTES) : 30;

/** Left out of what the reviewer sees: packages, build output, version control and everything that names the arm. */
const HIDE = new Set(['node_modules', 'dist', 'dist-test', 'build', 'coverage', '.git', '.worklings', '.claude', 'CLAUDE.md', 'claude.md', 'AGENTS.md', '.DS_Store']);
const LEAK = /worklings|headcount|\.claude\b|CLAUDE\.md|\bone[- ]prompt\b|\bbenchmark\b/i;

const task = requireTask(process.argv[2]);
const [pathA, pathB] = [process.argv[3], process.argv[4]].map((p) => (p ? resolve(p) : null));
if (!pathA || !pathB) die('Usage: review.mjs <task> <outA> <outB>  (the folders run-a.mjs and run-b.mjs saved)');

/** The project of one run, after checking its result.json says it is the arm and task we think it is. */
function load(dir, arm) {
  const project = join(dir, 'project');
  if (!existsSync(project)) die(`No project to review: expected ${project}.`);
  if (existsSync(join(dir, 'result.json'))) {
    const r = readJson(join(dir, 'result.json'));
    if (r.arm !== arm) die(`${dir} is arm ${r.arm}, but it was given as arm ${arm}. Order: <task> <outA> <outB>.`);
    if (r.task !== task) die(`${dir} is task ${r.task}, not ${task}.`);
  }
  return project;
}
const projects = { A: load(pathA, 'A'), B: load(pathB, 'B') };

const reviewsRoot = resolve(process.env.BENCH_REVIEWS ?? join(dirname(pathA), '..', 'reviews'));
const saveDir = join(reviewsRoot, task);
if (existsSync(join(saveDir, 'review.json')) && process.env.BENCH_FORCE !== '1') die(`${join(saveDir, 'review.json')} exists already. Set BENCH_FORCE=1 to overwrite, or BENCH_REVIEWS to save elsewhere.`);
mkdirSync(saveDir, { recursive: true });

const goal = goalOf(task);
const schema = reviewSchema();

const prompt = `You are a senior engineer reviewing two independent solutions to the same goal. You do not know who or what made them; judge only what is in front of you.

THE GOAL
${goal}

THE TWO SOLUTIONS
They are in the folders ./solution-1 and ./solution-2 of your working folder. Review both against the goal, with the same care.

HOW TO REVIEW
- Read the code, the tests and the documentation of each solution.
- You may install, build and run the tests and the program of each solution, with Bash, from inside that solution's folder only (cd into it first). Do not change any file, do not read or write outside ./solution-1 and ./solution-2, and do not use the network except for npm installing a solution's own dependencies.
- Prefer evidence to impressions: run it on realistic inputs and on edge cases you think of from the goal (empty and malformed input, errors, unusual cases), and see what happens. For a UI, judge from the code and from what you can run; say so in the notes when you could not run it.
- Judge the outcome only: how it was made is not your concern, and size or polish for its own sake earns nothing. A solution that is shorter and correct beats a longer one with gaps.

THE RUBRIC
Score each solution from 1 to 10 on every criterion (10: you would be glad to ship it as is; 7: good with small gaps; 5: works for the main case but with real gaps; 3: major problems; 1: does not work). Use the whole range and do not give both solutions the same score unless they really are equal. Give a one-line reason for every score. Criteria:
${CRITERIA.map((c) => `- ${c.key} (${c.label}): ${c.ask}.`).join('\n')}
"ux" may be null only when the criterion cannot apply at all; for a command line tool it is the usability of its output, errors and usage.
Then say which solution you would ship and why, in one or two sentences ("neither" only if neither is shippable).

YOUR ANSWER
Your final message must be ONLY one JSON object that follows this JSON Schema, with no text before or after it:
${JSON.stringify(schema)}
`;

/** Copies one project to <folder>/<name> without what is hidden; returns the files that still name the arm or Worklings. */
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

/** What a reviewer's `--output-format json` output holds: its reply text, a structured answer if there is one, cost. */
function readOutput(file) {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { text: raw, structured: null, costUsd: null, subtype: null };
  }
  const final = Array.isArray(doc) ? [...doc].reverse().find((l) => l?.type === 'result') : doc;
  return {
    text: typeof final?.result === 'string' ? final.result : '',
    structured: final?.structured_output ?? null,
    costUsd: typeof final?.total_cost_usd === 'number' ? final.total_cost_usd : null,
    subtype: final?.subtype ?? null,
  };
}

const other = (arm) => (arm === 'A' ? 'B' : 'A');
const first = process.env.BENCH_REVIEW_FIRST === 'A' || process.env.BENCH_REVIEW_FIRST === 'B' ? process.env.BENCH_REVIEW_FIRST : Math.random() < 0.5 ? 'A' : 'B';
const exe = process.env.BENCH_REVIEW_CLAUDE || process.env.WORKLINGS_CLAUDE || '';
const [command, lead] = !exe ? ['claude', []] : /\.(mjs|cjs|js|ts)$/i.test(exe) ? [process.execPath, [exe]] : [exe, []];
const fake = Boolean(exe);
const env = await soloEnv();
const blindnessLeaks = {};
const rounds = [];

console.log(`review of ${task}: ${fake ? `FAKE claude (${exe})` : 'REAL claude'}, model ${REVIEW_MODEL}, ${ROUNDS} round(s), solution-1 is ${first} in round 1, saving to ${saveDir}`);

for (let n = 1; n <= ROUNDS; n += 1) {
  const solution1 = n % 2 === 1 ? first : other(first);
  const order = { 'solution-1': solution1, 'solution-2': other(solution1) };
  const folder = mkdtempSync(join(tmpdir(), 'review-'));
  const outFile = join(tmpdir(), `${basename(folder)}.output.json`);
  const errFile = join(tmpdir(), `${basename(folder)}.stderr.txt`);
  const startedAt = now();
  try {
    for (const s of SOLUTIONS) {
      const leaks = place(projects[order[s]], folder, s);
      if (leaks.length > 0) blindnessLeaks[order[s]] = [...new Set([...(blindnessLeaks[order[s]] ?? []), ...leaks])];
    }
    const args = [
      ...lead, '-p', '--model', REVIEW_MODEL, '--output-format', 'json', '--json-schema', JSON.stringify(schema),
      '--permission-mode', process.env.BENCH_REVIEW_PERMISSION || 'dontAsk',
      '--allowedTools', 'Bash', 'Read', 'Grep', 'Glob',
      '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'mcp__*', ...NO_KILL_RULES,
      '--no-session-persistence', '--settings', '{"disableAllHooks":true}',
    ];
    if (Number(process.env.BENCH_REVIEW_BUDGET) > 0) args.push('--max-budget-usd', String(Number(process.env.BENCH_REVIEW_BUDGET)));
    console.log(`round ${n}: reviewing (the order is recorded and kept private until the scores are in)`);
    const ran = await runLogged(command, args, { cwd: folder, env, input: prompt, stdoutFile: outFile, stderrFile: errFile, timeoutMs: ROUND_MINUTES * 60_000 });
    // Let the file streams flush before reading the output back.
    await new Promise((done) => setTimeout(done, 300));
    const out = readOutput(outFile);
    const answer = out.structured && typeof out.structured === 'object' ? out.structured : extractJson(out.text);
    const problems = ran.timedOut ? [`timed out after ${ROUND_MINUTES} min`] : answer ? validateReview(answer) : ['no JSON object in the reply'];
    const round = { round: n, order, ok: problems.length === 0, problems, wallMs: now() - startedAt, costUsd: out.costUsd, exitCode: ran.code, subtype: out.subtype };
    if (round.ok) {
      const of = (arm) => answer.solutions[SOLUTIONS.find((s) => order[s] === arm)];
      round.scores = { A: of('A').scores, B: of('B').scores };
      round.notes = { A: of('A').notes, B: of('B').notes };
      round.ship = { choice: answer.ship.choice === 'neither' ? 'neither' : order[answer.ship.choice], why: answer.ship.why };
    } else round.rawReply = out.text.slice(0, 4000);
    rounds.push(round);
    writeJson(join(saveDir, `round-${n}.json`), round);
    const cost = out.costUsd === null ? 'cost unknown' : `$${out.costUsd.toFixed(2)}`;
    console.log(round.ok ? `round ${n}: solution-1 was arm ${order['solution-1']}; overall A ${round.scores.A.overall}, B ${round.scores.B.overall}, would ship ${round.ship.choice} (${(round.wallMs / 1000).toFixed(0)} s, ${cost})` : `round ${n}: no valid review (${problems.join('; ')})`);
  } finally {
    removeTree(folder);
    removeTree(outFile);
    removeTree(errFile);
  }
}

const good = rounds.filter((r) => r.ok);
const meanOf = (arm) => Object.fromEntries(KEYS.map((k) => [k, mean(good.map((r) => r.scores[arm][k]))]));
const ship = { A: 0, B: 0, neither: 0 };
for (const r of good) ship[r.ship.choice] += 1;
const costs = rounds.map((r) => r.costUsd);
const review = {
  task, reviewedAt: new Date().toISOString(), dryRun: fake, model: REVIEW_MODEL, rounds: rounds.length, validRounds: good.length,
  mean: { A: meanOf('A'), B: meanOf('B') }, ship,
  // A reviewer that picks different arms when the order flips is following position, not quality.
  positionBias: good.length >= 2 && new Set(good.map((r) => r.ship.choice)).size > 1,
  blindnessLeaks, costUsd: costs.every((c) => typeof c === 'number') ? costs.reduce((a, c) => a + c, 0) : null,
  roundResults: rounds,
};
writeJson(join(saveDir, 'review.json'), review);
if (Object.keys(blindnessLeaks).length > 0) console.warn(`WARNING: files that still name the arm or Worklings were shown to the reviewer: ${JSON.stringify(blindnessLeaks)}`);
console.log(
  good.length === 0
    ? 'no valid review'
    : `mean overall: A ${review.mean.A.overall.toFixed(1)}, B ${review.mean.B.overall.toFixed(1)}; would ship A ${ship.A}, B ${ship.B}, neither ${ship.neither} of ${good.length}${review.positionBias ? ' (the rounds disagree: position bias)' : ''}; saved to ${join(saveDir, 'review.json')}`,
);
process.exit(good.length === 0 ? 1 : 0);
