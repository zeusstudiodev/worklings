// v0.9's decision rule for packs (SPEC-v0.9.md, "How each pack is measured"), and its check against two identical arms.
//
//   node scripts/bench/packs-rule.mjs --null <parity report.json> [tasks per pack ...]
//
// The rule is applied to one pack's pairs (each pair: the task, the hidden-test rates of both arms, the blind judge's pair
// score for the pack arm, both arms' costs). `--null` checks the rule before any pack runs: v0.7's parity bench ran the
// same Claude Code in both arms (its launch held to plain `claude -p` by the parity contract), so its 20 pairs are two
// identical arms. Every way of picking k of its 10 tasks (both rounds of each), read in both directions, is a pack that
// does nothing; the share of them the rule passes is its false-positive rate at k tasks.
import { readFileSync } from 'node:fs';

/** What a pack must reach. Fixed before the bench runs (SPEC-v0.9.md). */
export const RULE = {
  /** Hidden tests: the pack arm's mean pass rate may trail plain's by at most this many points. */
  hiddenFloor: -2,
  /** The judge: the pack arm's mean pair score (0.5 is a tie) must reach this... */
  judgeMean: 0.65,
  /** ...and no task may have the pack arm behind on average. */
  noTaskBehind: true,
  /** Or the hidden tests: at least this many points ahead by the mean... */
  hiddenGain: 5,
  /** ...ahead in at least this many tasks, behind in none, with the judge at least a tie. */
  hiddenTasks: 2,
};

const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * The rule over one pack's pairs: [{ task, hiddenPlain, hiddenPack (0 to 1, or null), score (0 to 1), costPlain, costPack }].
 * `costCeiling` is the pack's own, shown in the start form before anyone adds it.
 */
export function judgePack(pairs, costCeiling) {
  const scored = pairs.filter((p) => typeof p.score === 'number');
  const hidden = pairs.filter((p) => typeof p.hiddenPlain === 'number' && typeof p.hiddenPack === 'number');
  const tasks = [...new Set(pairs.map((p) => p.task))];
  const byTask = (pick, from) => tasks.map((t) => from.filter((p) => p.task === t).map(pick)).filter((xs) => xs.length > 0).map(mean);
  const hiddenDiff = hidden.length === 0 ? 0 : 100 * mean(hidden.map((p) => p.hiddenPack - p.hiddenPlain));
  const taskHidden = byTask((p) => 100 * (p.hiddenPack - p.hiddenPlain), hidden);
  const judgeMean = mean(scored.map((p) => p.score));
  const taskJudge = byTask((p) => p.score, scored);
  const ratios = pairs.filter((p) => p.costPlain > 0 && typeof p.costPack === 'number').map((p) => p.costPack / p.costPlain);
  const costMedian = median(ratios);
  const notWorse = hiddenDiff >= RULE.hiddenFloor;
  const judgeHelped = judgeMean >= RULE.judgeMean && (!RULE.noTaskBehind || taskJudge.every((s) => s >= 0.5));
  const hiddenHelped = hiddenDiff >= RULE.hiddenGain && taskHidden.filter((d) => d > 0).length >= RULE.hiddenTasks && taskHidden.every((d) => d >= 0) && judgeMean >= 0.5;
  const costOk = costCeiling === undefined || costMedian === null || costMedian <= costCeiling;
  return {
    pairs: pairs.length, tasks: tasks.length, hiddenDiff, taskHidden, judgeMean, taskJudge, costMedian,
    notWorse, judgeHelped, hiddenHelped, costOk, holds: notWorse && (judgeHelped || hiddenHelped) && costOk,
  };
}

/** The pairs of a parity report as a pack that does nothing: the job arm as the pack, or (flipped) the plain arm. */
function nullPairs(report, flipped) {
  return report.pairs.map((p) => ({
    task: p.task,
    hiddenPlain: (flipped ? p.job : p.plain).hidden?.rate ?? null,
    hiddenPack: (flipped ? p.plain : p.job).hidden?.rate ?? null,
    score: typeof p.judge?.score === 'number' ? (flipped ? 1 - p.judge.score : p.judge.score) : null,
    costPlain: (flipped ? p.job : p.plain).cost,
    costPack: (flipped ? p.plain : p.job).cost,
  }));
}

function* subsets(items, k, from = 0, picked = []) {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = from; i < items.length; i++) yield* subsets(items, k, i + 1, [...picked, items[i]]);
}

/** The share of null packs of k tasks the rule passes, each part of it too. */
export function nullRate(report, k) {
  const tasks = [...new Set(report.pairs.map((p) => p.task))];
  let n = 0;
  const passed = { holds: 0, judgeHelped: 0, hiddenHelped: 0, notWorse: 0 };
  for (const flipped of [false, true]) {
    const all = nullPairs(report, flipped);
    for (const pick of subsets(tasks, k)) {
      const v = judgePack(all.filter((p) => pick.includes(p.task)));
      n += 1;
      for (const key of Object.keys(passed)) if (v[key]) passed[key] += 1;
    }
  }
  return { k, packs: n, ...Object.fromEntries(Object.entries(passed).map(([key, v]) => [key, v / n])) };
}

if (process.argv[2] === '--null') {
  const report = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const ks = process.argv.slice(4).map(Number).filter((k) => k > 0);
  for (const k of ks.length > 0 ? ks : [2, 3, 4]) {
    const r = nullRate(report, k);
    console.log(`${k} tasks (${2 * k} pairs), ${r.packs} null packs: the rule passes ${(100 * r.holds).toFixed(1)}% (judge part ${(100 * r.judgeHelped).toFixed(1)}%, hidden part ${(100 * r.hiddenHelped).toFixed(1)}%, not worse ${(100 * r.notWorse).toFixed(1)}%)`);
  }
}
