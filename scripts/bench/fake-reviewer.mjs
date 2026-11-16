// A stand-in for the reviewer's `claude -p` in the benchmark's dry run (BENCH_REVIEW_CLAUDE=scripts/bench/fake-reviewer.mjs):
// it calls no model and costs nothing. It looks at ./solution-1 and ./solution-2 in the current folder, scores the one
// with more files higher (so un-blinding can be checked: the same arm must win whichever order it is shown in), and
// answers in the shape of `--output-format json`, with the review in a fenced block as a model might write it.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { answerClaudeCommand } from '../../test/fake-claude-cli.mjs';
import { KEYS, SOLUTIONS } from './review-schema.mjs';

await answerClaudeCommand(process.argv.slice(2));
for await (const chunk of process.stdin) void chunk;

const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
const files = Object.fromEntries(SOLUTIONS.map((s) => [s, count(join(process.cwd(), s))]));
const winner = files['solution-1'] >= files['solution-2'] ? 'solution-1' : 'solution-2';
const solutions = Object.fromEntries(
  SOLUTIONS.map((s) => [
    s,
    {
      scores: Object.fromEntries(KEYS.map((k) => [k, s === winner ? 8 : 6])),
      notes: Object.fromEntries(KEYS.map((k) => [k, `Fake review of ${k}: ${files[s]} files.`])),
    },
  ]),
);
const review = { solutions, ship: { choice: winner, why: 'Fake reviewer: it has more files.' } };
const result = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 10,
  num_turns: 1,
  result: `Here is my review.\n\`\`\`json\n${JSON.stringify(review, null, 2)}\n\`\`\``,
  session_id: '00000000-0000-4000-8000-0000000000b1',
  total_cost_usd: 0,
  usage: { input_tokens: 1, output_tokens: 1 },
};
process.stdout.write(`${JSON.stringify(result)}\n`);
