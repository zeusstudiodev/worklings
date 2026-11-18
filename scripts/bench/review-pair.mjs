// v0.7's blind pairwise preference (SPEC-v0.7.md, "Proving not worse"): Opus reads what two runs of the same task produced
// and says which fulfils the request better, or that neither does meaningfully better. Paired comparisons are far less
// noisy than absolute scores. Each pair is judged twice, the two projects swapped, so a preference for a position cancels.
//
//   node scripts/bench/review-pair.mjs <task> <plain-run-dir> <job-run-dir> <out-dir>
//
// The judge sees the goal and, for each project, its files (for a task with a starting point, only the files the run
// added or changed, with the removed ones named), under the neutral names "Project 1" and "Project 2"; never which arm
// made which, the costs, the hidden tests or the office's records (run-job.mjs leaves .worklings out of project/). One
// request, no tools: `--tools ""`, the bench's blank profile, a neutral empty folder, and the kill deny rules all the same.
//
// Environment: BENCH_ROOT, BENCH_REVIEW_MODEL (opus), BENCH_FORCE. Writes <out>/round-1.json and round-2.json (each with
// costUsd, so spent.mjs counts them) and <out>/pair.json: the job arm's outcome per order and combined (win, tie or loss).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { NO_KILL_RULES } from './kill-guard.mjs';
import { die, goalOf, now, readJson, removeTree, requireTask, runLogged, soloEnv, taskDir, writeJson } from './lib.mjs';
import { PROFILE_CLAUDE } from './parity-lib.mjs';

const task = requireTask(process.argv[2]);
const [plainRun, jobRun, outArg] = process.argv.slice(3).map((p) => (p ? resolve(p) : p));
if (!plainRun || !jobRun || !outArg) die('Usage: review-pair.mjs <task> <plain-run-dir> <job-run-dir> <out-dir>');
const out = outArg;
mkdirSync(out, { recursive: true });
if (existsSync(join(out, 'pair.json')) && process.env.BENCH_FORCE !== '1') die(`${join(out, 'pair.json')} exists already; BENCH_FORCE=1 to judge again.`);
const MODEL = process.env.BENCH_REVIEW_MODEL || 'opus';
const goal = goalOf(task);
const start = join(taskDir(task), 'start');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.worklings', '.worklings-shared', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.next', '.cache']);
// v0.9's packs bench (BENCH_JUDGE_SKIP_CLAUDE=1): the pack's own files under .claude/ are left out of both projects, so the
// judge never sees which arm had a pack.
if (process.env.BENCH_JUDGE_SKIP_CLAUDE === '1') SKIP_DIRS.add('.claude');
const SKIP_FILES = /(^|[\\/])(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.(png|jpe?g|gif|ico|webp|woff2?|ttf|db|sqlite|zip|gz|pdf|mp3|mp4|wasm))$/i;
const FILE_CAP = 60_000;
const PROJECT_CAP = 110_000;

function filesOf(root) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (!SKIP_FILES.test(p)) found.push(relative(root, p).split(sep).join('/'));
    }
  };
  if (existsSync(root)) walk(root);
  return found;
}

const text = (path) => {
  const buf = readFileSync(path);
  if (buf.includes(0)) return null;
  const t = buf.toString('utf8');
  return t.length > FILE_CAP ? `${t.slice(0, FILE_CAP)}\n[... cut: the file goes on for ${t.length - FILE_CAP} more characters]` : t;
};

/** A project as the judge reads it: every file, or, over a starting point, what the run added, changed and removed. */
function pack(project) {
  const files = filesOf(project);
  const base = existsSync(start) ? new Set(filesOf(start)) : null;
  const parts = [];
  const removed = base ? [...base].filter((f) => !files.includes(f)) : [];
  for (const f of files) {
    const body = text(join(project, f));
    if (body === null) continue;
    if (base?.has(f)) {
      const before = text(join(start, f));
      if (before === body) continue;
      parts.push(`--- ${f} (changed from the starting point; its full new text)\n${body}`);
    } else parts.push(`--- ${f}${base ? ' (added)' : ''}\n${body}`);
  }
  let joined = parts.join('\n\n');
  if (removed.length > 0) joined += `\n\n--- removed from the starting point: ${removed.join(', ')}`;
  if (parts.length === 0) joined = '(no files changed or added)';
  return joined.length > PROJECT_CAP ? `${joined.slice(0, PROJECT_CAP)}\n[... cut: ${joined.length - PROJECT_CAP} more characters of this project]` : joined;
}

const packs = { plain: pack(join(plainRun, 'project')), job: pack(join(jobRun, 'project')) };
const startNote = existsSync(start)
  ? 'Both started from the same existing codebase; you see only what each added, changed or removed, with the full new text of each changed file.'
  : 'Both started from an empty folder; you see every file each produced (lockfiles, builds and binaries left out).';

function prompt(first, second) {
  return [
    `You are an expert reviewer comparing two independent attempts at the same request. Judge which one fulfils the request better for the person who asked: correctness first (does it do what was asked, including the details and edge cases the request states), then completeness, then the quality of the code, tests and documentation the request asks for. Judge only what you can see${process.env.BENCH_JUDGE_ASKED === '1' ? '' : '; neither attempt could ask questions'}. Prefer "tie" when the difference is small or a matter of taste.`,
    ...(process.env.BENCH_JUDGE_ASKED === '1' ? ['', 'The person typed a shorter request than the one below, and either attempt could ask the person questions before building; the request below is what the person wanted, so judge against it.'] : []),
    '',
    `The request:\n${goal}`,
    '',
    startNote,
    '',
    `=== Project 1 ===\n${first}\n=== end of Project 1 ===`,
    '',
    `=== Project 2 ===\n${second}\n=== end of Project 2 ===`,
    '',
    'Answer with only a JSON object, no other text: {"better": "1" | "2" | "tie", "margin": "small" | "clear" | "large", "reasons": ["up to five short reasons, each naming the project it is about"]}',
  ].join('\n');
}

const parse = (raw) => {
  const m = /\{[\s\S]*\}/.exec(raw ?? '');
  try {
    const j = JSON.parse(m?.[0] ?? '');
    return ['1', '2', 'tie'].includes(String(j.better)) ? { better: String(j.better), margin: j.margin ?? null, reasons: Array.isArray(j.reasons) ? j.reasons.slice(0, 5) : [] } : null;
  } catch {
    return null;
  }
};

const env = { ...(await soloEnv()), BENCH_PROFILE: 'blank' };
const rounds = [];
for (const [round, order] of [[1, ['plain', 'job']], [2, ['job', 'plain']]]) {
  const file = join(out, `round-${round}.json`);
  if (existsSync(file) && process.env.BENCH_FORCE !== '1') {
    rounds.push(readJson(file));
    continue;
  }
  const folder = mkdtempSync(join(tmpdir(), 'bench-judge-'));
  const startedAt = now();
  const outFile = join(out, `round-${round}.out.json`);
  const ran = await runLogged(process.execPath, [PROFILE_CLAUDE, '-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--disallowedTools', ...NO_KILL_RULES], {
    cwd: folder, env, input: prompt(packs[order[0]], packs[order[1]]), stdoutFile: outFile, stderrFile: join(out, `round-${round}.err.txt`), timeoutMs: 15 * 60_000,
  });
  removeTree(folder);
  let result = null;
  try {
    result = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    // reported below
  }
  const verdict = parse(result?.result);
  // The job arm's outcome in this order: which position it held, and whether that position was preferred.
  const jobAt = String(order.indexOf('job') + 1);
  const outcome = verdict === null ? null : verdict.better === 'tie' ? 'tie' : verdict.better === jobAt ? 'win' : 'loss';
  const r = { round, order, model: MODEL, ok: verdict !== null, verdict, outcome, costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : 0, wallMs: now() - startedAt, exitCode: ran.code };
  writeJson(file, r);
  rounds.push(r);
}
const [a, b] = rounds.map((r) => r.outcome);
// Each order scores the job arm 1 for a win, 0.5 for a tie and 0 for a loss; the pair's score is their mean, so a
// preference that flips with the order counts as a tie, and a lean in one order with a tie in the other as a half win.
const points = { win: 1, tie: 0.5, loss: 0 };
const score = a === null || b === null ? null : (points[a] + points[b]) / 2;
const combined = score === null ? null : score > 0.5 ? 'win' : score < 0.5 ? 'loss' : 'tie';
const pair = { task, plainRun, jobRun, model: MODEL, outcomes: [a, b], score, combined, atLeastAsGood: score === null ? null : score >= 0.5, costUsd: rounds.reduce((s, r) => s + (r.costUsd ?? 0), 0) };
writeJson(join(out, 'pair.json'), pair);
writeFileSync(join(out, 'packs-chars.txt'), `plain ${packs.plain.length}\njob ${packs.job.length}\n`);
console.log(`${task}: job ${a} / ${b} -> ${combined}, $${pair.costUsd.toFixed(3)}`);
