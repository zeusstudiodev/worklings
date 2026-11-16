// v0.7's parity report (SPEC-v0.7.md, "Decision rule"): reads a parity bench folder (parity-all.mjs) and writes report.md
// and report.json beside it. Every interval is clustered by task (arXiv 2411.00640): the tasks are resampled with
// replacement, each bringing all of its pairs, 20,000 times with a fixed seed, and the 2.5th and 97.5th percentiles kept.
//
//   node scripts/bench/parity-report.mjs <bench-folder>
//
// The decision rule, each part on its own line of the report:
//   - hidden tests: the Worklings arm's pass rate within 2 points of plain (the mean difference, task-clustered, at least -2);
//   - preference: Worklings at least as good (a pair scoring 0.5 or more over the two orders) in at least 45% of pairs, at
//     the interval's lower bound;
//   - cost at most 1.1 times plain and wall time at most 1.15 times, as ratios of the means;
//   - no more prompts to the person than plain Claude Code would have asked (its permission denials and questions).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { die, readJson } from './lib.mjs';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(root)) die('Say which bench folder to report.');

const read = (file) => (existsSync(file) ? readJson(file) : null);
/** Hidden tests over every suite of a run: passed and total. */
function hidden(score) {
  if (!score?.hidden) return null;
  let passed = 0;
  let total = 0;
  for (const s of Object.values(score.hidden)) {
    passed += s.passed ?? 0;
    total += s.total ?? 0;
  }
  return total > 0 ? { passed, total, rate: passed / total } : null;
}

const pairs = [];
for (const task of readdirSync(root).filter((t) => existsSync(join(root, t, 'r1')))) {
  for (const r of readdirSync(join(root, task)).filter((x) => /^r\d+$/.test(x)).sort()) {
    const dir = join(root, task, r);
    const p = read(join(dir, 'plain', 'result.json'));
    const w = read(join(dir, 'job', 'result.json'));
    if (!p || !w) continue;
    const judge = read(join(dir, 'judge', 'pair.json'));
    pairs.push({
      task, round: r,
      plain: { hidden: hidden(read(join(dir, 'plain', 'score.json'))), cost: p.costUsd, wall: p.wallMs, prompts: (p.prompts?.permissionDenials ?? 0) + (p.prompts?.questionsAnswered ?? 0), done: p.done, capped: p.capped },
      job: { hidden: hidden(read(join(dir, 'job', 'score.json'))), cost: w.costUsd, wall: w.wallMs, desk: w.deskMs, prompts: (w.prompts?.permissionDenied ?? 0) + (w.prompts?.questionsAnswered ?? 0), done: w.done, capped: w.capped, failure: w.failure, helpers: w.helpers?.length ?? 0 },
      judge: judge ? { outcomes: judge.outcomes, score: judge.score, combined: judge.combined, cost: judge.costUsd } : null,
    });
  }
}
if (pairs.length === 0) die('No finished pairs.');
const tasks = [...new Set(pairs.map((p) => p.task))];
const byTask = new Map(tasks.map((t) => [t, pairs.filter((p) => p.task === t)]));

// A small, seeded generator, so the intervals are the same on every run of the report.
let seed = 0x5eed;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** A statistic over a set of task clusters, with its task-clustered 95% interval. */
function clustered(stat) {
  const point = stat(tasks);
  const draws = [];
  for (let i = 0; i < 20_000; i++) {
    const pick = tasks.map(() => tasks[Math.floor(rand() * tasks.length)]);
    const v = stat(pick);
    if (Number.isFinite(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  return { point, low: draws[Math.floor(draws.length * 0.025)], high: draws[Math.floor(draws.length * 0.975)] };
}
const pairsOf = (ts) => ts.flatMap((t) => byTask.get(t) ?? []);

const scored = (ps) => ps.filter((p) => p.plain.hidden && p.job.hidden);
// Pass rates in points (percent), the job arm's minus plain's, averaged over pairs.
const hiddenDiff = clustered((ts) => mean(scored(pairsOf(ts)).map((p) => 100 * (p.job.hidden.rate - p.plain.hidden.rate))));
const judgedOf = (ps) => ps.filter((p) => p.judge && p.judge.score !== null);
const asGood = clustered((ts) => {
  const j = judgedOf(pairsOf(ts));
  return j.length === 0 ? Number.NaN : j.filter((p) => p.judge.score >= 0.5).length / j.length;
});
const winRate = clustered((ts) => mean(judgedOf(pairsOf(ts)).map((p) => p.judge.score)));
const costRatio = clustered((ts) => {
  const ps = pairsOf(ts);
  return mean(ps.map((p) => p.job.cost)) / mean(ps.map((p) => p.plain.cost));
});
const wallRatio = clustered((ts) => {
  const ps = pairsOf(ts);
  return mean(ps.map((p) => p.job.wall)) / mean(ps.map((p) => p.plain.wall));
});
const deskRatio = clustered((ts) => {
  const ps = pairsOf(ts).filter((p) => p.job.desk);
  return mean(ps.map((p) => p.job.desk)) / mean(ps.map((p) => p.plain.wall));
});
/** The median of the pairs' own ratios: one run that hangs on its own test for five minutes doesn't move it. */
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length === 0 ? Number.NaN : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const wallMedian = median(pairs.map((p) => p.job.wall / p.plain.wall));
const costMedian = median(pairs.map((p) => p.job.cost / p.plain.cost));
// What two identical arms would show: a pair scores above 0.5 as often as below it, so the share at least as good is
// 0.5 plus half the share of exact ties. The judge's own tie rate here gives the expected share and its spread.
const tieShare = judgedOf(pairs).filter((p) => p.judge.score === 0.5).length / Math.max(1, judgedOf(pairs).length);
const prompts = { plain: pairs.reduce((s, p) => s + p.plain.prompts, 0), job: pairs.reduce((s, p) => s + p.job.prompts, 0) };

const rule = {
  hidden: { pass: hiddenDiff.point >= -2, text: `mean difference ${hiddenDiff.point.toFixed(1)} points (95% ${hiddenDiff.low.toFixed(1)} to ${hiddenDiff.high.toFixed(1)}), needs at least -2` },
  preference: { pass: asGood.low >= 0.45, text: `${(100 * asGood.point).toFixed(0)}% of pairs at least as good (95% ${(100 * asGood.low).toFixed(0)}% to ${(100 * asGood.high).toFixed(0)}%), needs the lower bound at 45% or more` },
  cost: { pass: costRatio.point <= 1.1, text: `${costRatio.point.toFixed(2)}x plain (95% ${costRatio.low.toFixed(2)} to ${costRatio.high.toFixed(2)}), needs at most 1.1` },
  wall: { pass: wallRatio.point <= 1.15, text: `${wallRatio.point.toFixed(2)}x plain (95% ${wallRatio.low.toFixed(2)} to ${wallRatio.high.toFixed(2)}), needs at most 1.15; the desk alone ${deskRatio.point.toFixed(2)}x` },
  prompts: { pass: prompts.job <= prompts.plain, text: `${prompts.job} for Worklings, ${prompts.plain} for plain (its denials and answered questions)` },
};
const holds = Object.values(rule).every((r) => r.pass);

const money = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a');
const secs = (ms) => (typeof ms === 'number' ? `${Math.round(ms / 1000)} s` : 'n/a');
const rate = (h) => (h ? `${h.passed}/${h.total}` : 'n/a');
const lines = [
  '# v0.7 parity bench',
  '',
  `${pairs.length} pairs over ${tasks.length} tasks. Both arms: the blank profile, Sonnet, Claude Code's default effort, the same permission mode. Intervals are 95%, clustered by task (${tasks.length} clusters, 20,000 resamples).`,
  '',
  `**Decision rule: ${holds ? 'holds' : 'does not hold'}.**`,
  '',
  ...Object.entries(rule).map(([k, r]) => `- ${k}: ${r.pass ? 'pass' : 'FAIL'}, ${r.text}`),
  `- the job arm's mean pairwise score: ${winRate.point.toFixed(2)} (95% ${winRate.low.toFixed(2)} to ${winRate.high.toFixed(2)}; 0.5 is a tie)`,
  `- the median of the pairs' own ratios: time ${wallMedian.toFixed(2)}x, cost ${costMedian.toFixed(2)}x`,
  `- two identical arms would be at least as good in about ${(100 * (0.5 + tieShare / 2)).toFixed(0)}% of pairs with this judge's tie rate (${(100 * tieShare).toFixed(0)}% exact ties); with ${tasks.length} task clusters the interval's lower bound sits well below that, so the 45% bound can fail for identical arms`,
  '',
  '| Task | Round | Hidden plain | Hidden Worklings | Judge (both orders) | Pair score | Cost plain | Cost Worklings | Time plain | Time Worklings | Prompts P / W |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...pairs.map((p) => `| ${p.task} | ${p.round} | ${rate(p.plain.hidden)} | ${rate(p.job.hidden)} | ${p.judge ? p.judge.outcomes.join(', ') : 'n/a'} | ${p.judge?.score ?? 'n/a'} | ${money(p.plain.cost)} | ${money(p.job.cost)} | ${secs(p.plain.wall)} | ${secs(p.job.wall)} | ${p.plain.prompts} / ${p.job.prompts} |`),
  '',
  'Judge outcomes are the Worklings arm\'s, in the order plain-first, then Worklings-first. A pair scores 1 for a win, 0.5 for a tie and 0 for a loss, averaged over the two orders.',
];
writeFileSync(join(root, 'report.md'), `${lines.join('\n')}\n`);
writeFileSync(join(root, 'report.json'), `${JSON.stringify({ pairs, rule, holds, hiddenDiff, asGood, winRate, costRatio, wallRatio, deskRatio, wallMedian, costMedian, tieShare, prompts }, null, 2)}\n`);
console.log(lines.slice(0, 12).join('\n'));
