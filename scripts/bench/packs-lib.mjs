// v0.9's packs bench (SPEC-v0.9.md): the groups of tasks and arms both the runner (packs-all.mjs) and the report
// (packs-report.mjs) read, and what the bench has spent. Check before done and the review round were measured and not
// shipped in 0.4.0, so the checks group's pack arms need their files from commit bb89505 (library/packs) to run again.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Each measured pack's title and the cost line its rule was held to, fixed before the bench ran (SPEC-v0.9.md). */
export const MEASURED = {
  kickoff: { title: 'Kickoff', costCeiling: 1.5 },
  'check-before-done': { title: 'Check before done', costCeiling: 1.5 },
  'review-round': { title: 'Review round', costCeiling: 2.5 },
};

export const GROUPS = {
  kickoff: {
    tasks: ['link-checker', 'feature', 'data-script'],
    arms: { plain: '', kickoff: 'kickoff' },
    run: { BENCH_GOAL: 'goal-short.md', BENCH_ANSWER_QUESTIONS: 'stakeholder' },
    judge: { BENCH_JUDGE_ASKED: '1', BENCH_JUDGE_SKIP_CLAUDE: '1' },
  },
  checks: {
    tasks: ['game', 'api', 'multifile', 'bookshop'],
    arms: { plain: '', check: 'check-before-done', review: 'review-round' },
    /** The review round runs on the bigger tasks only. */
    only: { review: ['api', 'multifile', 'bookshop'] },
    run: {},
    judge: { BENCH_JUDGE_SKIP_CLAUDE: '1' },
  },
};
/** Everything spent under the bench folder: each run's result.json (answers included) and each judge round. */
export function spentUnder(root) {
  let total = 0;
  const walk = (dir, depth) => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === 'project' || name === 'scoring' || name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, depth + 1);
      else if (name === 'result.json' || /^round-\d+\.json$/.test(name)) {
        try {
          const j = JSON.parse(readFileSync(p, 'utf8'));
          if (typeof j.costUsd === 'number') total += j.costUsd;
        } catch {
          // a file being written
        }
      }
    }
  };
  walk(root, 0);
  return total;
}

