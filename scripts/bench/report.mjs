// A markdown report of benchmark runs that leads with the quality of what was built.
//
//   node scripts/bench/report.mjs <out>... [--reviews <folder>] [--write <file>]
//
// Each <out> is a folder run-a.mjs or run-b.mjs saved (result.json), scored or not (score.json). The blind reviews
// review.mjs saved are read from <reviews>/<task>/review.json (default: BENCH_REVIEWS, else <runs folder>/../reviews).
// Order of the report: the blind review (a summary across tasks, then per task the scores per arm and criterion and the
// shipping choice), then the checks (hidden tests, build, typecheck, lint, own tests), then cost and time last, then the
// caveats a reader needs. With --write the same text goes to a file as well.
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { die, readJson } from './lib.mjs';
import { CRITERIA, mean } from './review-schema.mjs';

let file = null;
let reviewsArg = null;
const dirs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--write') file = args[(i += 1)] ?? null;
  else if (args[i] === '--reviews') reviewsArg = args[(i += 1)] ?? null;
  else dirs.push(args[i]);
}
if (dirs.length === 0) die('Usage: report.mjs <out>... [--reviews <folder>] [--write <file>]');

const runs = [];
for (const d of dirs) {
  const dir = resolve(d);
  if (!existsSync(join(dir, 'result.json'))) {
    console.warn(`skipped ${dir}: no result.json`);
    continue;
  }
  runs.push({ dir, result: readJson(join(dir, 'result.json')), score: existsSync(join(dir, 'score.json')) ? readJson(join(dir, 'score.json')) : null });
}
runs.sort((x, y) => x.result.task.localeCompare(y.result.task) || x.result.arm.localeCompare(y.result.arm));
const tasks = [...new Set(runs.map((x) => x.result.task))];

const reviewsRoot = resolve(reviewsArg ?? process.env.BENCH_REVIEWS ?? join(dirname(runs[0]?.dir ?? '.'), '..', 'reviews'));
const reviews = {};
for (const task of tasks) {
  const f = join(reviewsRoot, task, 'review.json');
  if (existsSync(f)) reviews[task] = readJson(f);
}

const NAME = { A: 'A one prompt', B: 'B company' };
const yes = (v) => (v === null || v === undefined ? 'n/a' : v ? 'ok' : 'fail');
const usd = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : 'unknown');
const mins = (ms) => `${(ms / 60_000).toFixed(1)} min`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));
const tokens = (t) => (t ? `${k(t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h)} in / ${k(t.output)} out` : 'n/a');
const score1 = (v) => (typeof v === 'number' ? v.toFixed(1) : 'n/a');
const shipText = (s, n) => (s ? `A ${s.A}, B ${s.B}${s.neither > 0 ? `, neither ${s.neither}` : ''} of ${n}` : 'n/a');

const lines = [];

// --- 1. Quality: the blind review ----------------------------------------------------------------------------------
lines.push('## Quality: blind expert review', '');
const reviewed = tasks.filter((t) => reviews[t] && reviews[t].validRounds > 0);
if (reviewed.length === 0) {
  lines.push('No review yet: run `node scripts/bench/review.mjs <task> <outA> <outB>` for each task.', '');
} else {
  lines.push(
    'A fresh reviewer read both projects for the same goal, without knowing which arm made which (shown in a random order, then swapped, and averaged), and scored them from 1 to 10.',
    '',
    '| Arm | Tasks reviewed | Mean overall quality | Tasks it led on overall | Would ship (rounds) |',
    '|---|---|---|---|---|',
  );
  for (const arm of ['A', 'B']) {
    const overall = reviewed.map((t) => reviews[t].mean[arm].overall);
    const led = reviewed.filter((t) => (reviews[t].mean[arm].overall ?? 0) > (reviews[t].mean[arm === 'A' ? 'B' : 'A'].overall ?? 0)).length;
    const ship = { [arm]: reviewed.reduce((a, t) => a + reviews[t].ship[arm], 0), of: reviewed.reduce((a, t) => a + reviews[t].validRounds, 0) };
    lines.push(`| ${NAME[arm]} | ${reviewed.length} | ${score1(mean(overall))} | ${led} of ${reviewed.length} | ${ship[arm]} of ${ship.of} |`);
  }
  lines.push('');
  for (const t of reviewed) {
    const rv = reviews[t];
    lines.push(`### ${t}`, '', '| Criterion | A one prompt | B company |', '|---|---|---|');
    for (const c of CRITERIA) lines.push(`| ${c.key === 'overall' ? '**Overall**' : c.label} | ${score1(rv.mean.A[c.key])} | ${score1(rv.mean.B[c.key])} |`);
    lines.push('', `Would ship: ${shipText(rv.ship, rv.validRounds)} round(s). Reviewer: ${rv.model}, ${rv.validRounds} of ${rv.rounds} round(s) valid.`);
    for (const r of rv.roundResults.filter((x) => x.ok)) lines.push(`- Round ${r.round} (solution-1 was ${r.order['solution-1']}): overall A ${r.scores.A.overall}, B ${r.scores.B.overall}; would ship ${r.ship.choice === 'neither' ? 'neither' : r.ship.choice}: ${r.ship.why}`);
    lines.push('');
  }
}
for (const t of tasks.filter((t) => !reviewed.includes(t) && reviewed.length > 0)) lines.push(`${t}: not reviewed.`, '');

// --- 2. Checks: hidden tests, build, own tests ---------------------------------------------------------------------
lines.push('## Checks: hidden tests, build and the project\'s own tests', '', '| Task | Arm | Hidden tests | Build | Typecheck | Lint | Own tests | Finished |', '|---|---|---|---|---|---|---|---|');
for (const { result: r, score: s } of runs) {
  const hidden = s ? `${s.hiddenPassed}/${s.hiddenTotal}` : 'not scored';
  const finished = r.done ? 'yes' : r.capped ? 'capped' : r.arm === 'A' ? 'no' : 'failed';
  lines.push(`| ${r.task} | ${NAME[r.arm]} | ${hidden} | ${yes(s?.buildOk)} | ${yes(s?.typecheckOk)} | ${yes(s?.lintOk)} | ${yes(s?.ownTestsOk)} | ${finished} |`);
}
lines.push('', '| Arm | Runs | Hidden tests passed |', '|---|---|---|');
for (const arm of ['A', 'B']) {
  const mine = runs.filter((x) => x.result.arm === arm);
  if (mine.length === 0) continue;
  const scored = mine.filter((x) => x.score);
  const passed = scored.reduce((a, x) => a + x.score.hiddenPassed, 0);
  const total = scored.reduce((a, x) => a + x.score.hiddenTotal, 0);
  lines.push(`| ${NAME[arm]} | ${mine.length} | ${scored.length > 0 ? `${passed}/${total} (${((100 * passed) / total).toFixed(0)}%)` : 'not scored'} |`);
}

// --- 3. Cost and time, last ----------------------------------------------------------------------------------------
lines.push('', '## Cost and time', '', '| Task | Arm | API-equivalent cost | Tokens | Wall time | Interventions |', '|---|---|---|---|---|---|');
for (const { result: r } of runs) lines.push(`| ${r.task} | ${NAME[r.arm]} | ${usd(r.costUsd)} | ${tokens(r.tokens)} | ${mins(r.wallMs)} | ${r.interventions?.total ?? 0} |`);
lines.push('', '| Arm | Runs | Cost | Wall time |', '|---|---|---|---|');
for (const arm of ['A', 'B']) {
  const mine = runs.filter((x) => x.result.arm === arm);
  if (mine.length === 0) continue;
  const costs = mine.map((x) => x.result.costUsd);
  const cost = costs.every((c) => typeof c === 'number') ? usd(costs.reduce((a, c) => a + c, 0)) : 'unknown (a run has no cost)';
  lines.push(`| ${NAME[arm]} | ${mine.length} | ${cost} | ${mins(mine.reduce((a, x) => a + x.result.wallMs, 0))} |`);
}

// --- Caveats -------------------------------------------------------------------------------------------------------
const notes = [];
if (runs.some((x) => x.result.dryRun) || Object.values(reviews).some((x) => x.dryRun)) notes.push('Dry run: Claude Code was faked, so costs, scores and reviews say nothing about the real thing.');
for (const t of reviewed) {
  const rv = reviews[t];
  if (rv.validRounds < rv.rounds) notes.push(`${t} review: only ${rv.validRounds} of ${rv.rounds} round(s) gave a valid review (see round-<n>.json).`);
  if (rv.positionBias) notes.push(`${t} review: the rounds disagree on which solution to ship when the order flips, so position may have swayed the reviewer; read the per-round lines.`);
  for (const [arm, files] of Object.entries(rv.blindnessLeaks ?? {})) notes.push(`${t} review: files of arm ${arm} still named the arm or Worklings (${files.slice(0, 5).join(', ')}), so the review was not fully blind.`);
}
notes.push(...(reviewed.length > 0 ? ['Reviews are one reviewer model\'s judgement on a few projects: read them with the hidden tests, not instead of them.'] : []));
for (const { result: r, score: s } of runs) {
  const tag = `${r.task} ${r.arm}`;
  if (r.capped) notes.push(`${tag}: stopped at the wall-time cap, so it may be unfinished.`);
  if (r.stalled) notes.push(`${tag}: ${r.stalled}${r.stalledSays ? ` (the office said "${r.stalledSays}")` : ''}.`);
  if (r.failure) notes.push(`${tag}: the harness failed (${r.failure}).`);
  if (r.arm === 'B' && r.proposal) {
    const asked = r.scoping?.questions ?? 0;
    const scoped = asked > 0 ? `the CEO asked ${asked} scoping question(s), answered with its own picks, then proposed` : 'the CEO asked no scoping questions and proposed';
    notes.push(`${tag}: ${scoped} ${r.proposal.people} people${r.proposal.sizing ? ` ("${r.proposal.sizing}")` : ''}.`);
  }
  if (r.arm === 'B' && (r.interventions?.total ?? 0) > 0) {
    const i = r.interventions;
    notes.push(`${tag}: ${i.total} intervention(s) by the harness after the plan approval (models changed ${i.modelChanges}, approvals allowed ${i.approvalsAllowed}, denied ${i.approvalsDenied}, questions answered ${i.questionsAnswered}); see events.jsonl.`);
  }
  if (r.costKind && r.costKind !== 'reported') notes.push(`${tag}: cost is ${r.costKind}.`);
  if (r.leftoverProcesses?.length > 0) notes.push(`${tag}: programs left running: ${r.leftoverProcesses.map((p) => `${p.name} ${p.pid}`).join(', ')}.`);
  if (s?.hiddenNotRun > 0) notes.push(`${tag}: ${s.hiddenNotRun} hidden test(s) did not run (counted as failed).`);
  if (r.arm === 'A' && r.finalText && /\?\s*$/.test(r.finalText.trim())) notes.push(`${tag}: the session ended on a question; it may have asked instead of building.`);
}
if (notes.length > 0) lines.push('', '## Notes', ...notes.map((n) => `- ${n}`));

const text = `${lines.join('\n')}\n`;
process.stdout.write(text);
if (file) writeFileSync(resolve(file), text);
