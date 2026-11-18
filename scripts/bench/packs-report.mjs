// v0.9's packs report (SPEC-v0.9.md, "How each pack is measured"): reads a packs bench folder (packs-all.mjs) and writes
// report.md and report.json beside it, with each pack's decision rule (packs-rule.mjs) applied to its pairs.
//
//   node scripts/bench/packs-report.mjs <bench-folder>
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { die, readJson } from './lib.mjs';
import { GROUPS, MEASURED, spentUnder } from './packs-lib.mjs';
import { judgePack, RULE } from './packs-rule.mjs';

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

const armOf = (dir) => {
  const r = read(join(dir, 'result.json'));
  if (!r) return null;
  return {
    hidden: hidden(read(join(dir, 'score.json'))),
    cost: typeof r.jobCostUsd === 'number' ? r.jobCostUsd : r.costUsd,
    answerCost: r.answerCostUsd ?? 0,
    wall: r.wallMs,
    answers: r.answers?.length ?? 0,
    denials: r.prompts?.permissionDenials ?? 0,
    done: r.done,
    capped: r.capped,
  };
};

const packs = [];
for (const [groupName, group] of Object.entries(GROUPS)) {
  for (const [arm, packId] of Object.entries(group.arms)) {
    if (!packId) continue;
    const pairs = [];
    for (const task of group.tasks) {
      if (group.only?.[arm] && !group.only[arm].includes(task)) continue;
      const taskDir = join(root, groupName, task);
      if (!existsSync(taskDir)) continue;
      for (const round of readdirSync(taskDir).filter((r) => /^r\d+$/.test(r)).sort()) {
        const dir = join(taskDir, round);
        const plain = armOf(join(dir, 'plain'));
        const pack = armOf(join(dir, arm));
        if (!plain || !pack) continue;
        const judge = read(join(dir, `judge-${arm}`, 'pair.json'));
        pairs.push({ task, round, plain, pack, judge: judge ? { outcomes: judge.outcomes, score: judge.score, cost: judge.costUsd } : null });
      }
    }
    const verdict = judgePack(
      pairs.map((p) => ({ task: p.task, hiddenPlain: p.plain.hidden?.rate ?? null, hiddenPack: p.pack.hidden?.rate ?? null, score: p.judge?.score ?? null, costPlain: p.plain.cost, costPack: p.pack.cost })),
      MEASURED[packId].costCeiling,
    );
    packs.push({ id: packId, title: MEASURED[packId].title, group: groupName, tasks: [...new Set(pairs.map((p) => p.task))], pairs, verdict });
  }
}

const spent = spentUnder(dirname(root));
const money = (x) => `$${x.toFixed(2)}`;
const secs = (ms) => `${Math.round(ms / 1000)} s`;
const hiddenCell = (h) => (h ? `${h.passed}/${h.total}` : 'none');
const lines = [
  '# v0.9 packs bench',
  '',
  `Each pack's arm against plain Claude Code on the task kinds it claims to help (SPEC-v0.9.md). Both arms: \`claude -p\`, the blank profile, Sonnet, Claude Code's default effort, bypassPermissions, the machine-wide kill refusal as a hook; the pack arm's folder had the pack added by Worklings' own installer first. Judge: Opus, blind, both orders, the pack files under .claude/ left out of both projects. Spent in all (runs, the stand-in's answers, judges and probes): ${money(spent)}.`,
  '',
  `The rule (checked against two identical arms first: about 7% of null packs pass at three tasks, 3% at four): hidden tests at most ${-RULE.hiddenFloor} points behind plain; and either the judge's mean pair score at least ${RULE.judgeMean} with no task behind, or the hidden tests at least ${RULE.hiddenGain} points ahead, ahead in ${RULE.hiddenTasks} tasks and behind in none, with the judge at least a tie; and the median pair's cost ratio within the pack's own line.`,
  '',
];
for (const p of packs) {
  const v = p.verdict;
  lines.push(`## ${p.title} (\`${p.id}\`): ${p.pairs.length === 0 ? 'not run' : v.holds ? 'met its rule' : 'did not meet its rule'}`, '');
  if (p.pairs.length === 0) continue;
  lines.push(
    `- ${v.pairs} pairs over ${v.tasks} tasks (${p.tasks.join(', ')}).`,
    `- Hidden tests: ${v.hiddenDiff >= 0 ? '+' : ''}${v.hiddenDiff.toFixed(1)} points against plain on average (${v.notWorse ? 'not worse' : 'worse'}); by task ${v.taskHidden.map((d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}`).join(', ')}.`,
    `- Judge: mean pair score ${v.judgeMean.toFixed(2)} (0.5 is a tie); by task ${v.taskJudge.map((s) => s.toFixed(2)).join(', ')}. ${v.judgeHelped ? 'Meets the judge part.' : 'Misses the judge part.'}`,
    `- Hidden part: ${v.hiddenHelped ? 'met' : 'missed'}.`,
    `- Cost: median pair ratio ${v.costMedian === null ? 'unknown' : `${v.costMedian.toFixed(2)}x`} against a line of ${MEASURED[p.id].costCeiling}x (${v.costOk ? 'within' : 'over'}).`,
    '',
    "| Task | Round | Hidden plain | Hidden pack | Judge (the pack arm's, plain first then pack first) | Pair score | Cost plain | Cost pack | Time plain | Time pack | Answers P / pack |",
    '|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const x of p.pairs) {
    lines.push(`| ${x.task} | ${x.round} | ${hiddenCell(x.plain.hidden)} | ${hiddenCell(x.pack.hidden)} | ${x.judge ? x.judge.outcomes.join(', ') : 'not judged'} | ${x.judge?.score ?? ''} | ${money(x.plain.cost)} | ${money(x.pack.cost)} | ${secs(x.plain.wall)} | ${secs(x.pack.wall)} | ${x.plain.answers} / ${x.pack.answers} |`);
  }
  lines.push('');
}
lines.push('Costs are the sessions\' own (`total_cost_usd`, API-equivalent); the kickoff stand-in\'s answers are counted in the spend, not in either arm\'s cost.');
writeFileSync(join(root, 'report.md'), `${lines.join('\n')}\n`);
writeFileSync(join(root, 'report.json'), `${JSON.stringify({ spent, rule: RULE, packs }, null, 2)}\n`);
console.log(lines.filter((l) => l.startsWith('## ')).join('\n'));
console.log(`spent ${money(spent)}`);
