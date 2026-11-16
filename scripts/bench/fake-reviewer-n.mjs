// A stand-in for the reviewer's `claude -p` in a dry run of review-n.mjs: no model, no cost. It scores every
// ./solution-<n> folder by its file count (more files, higher), so un-blinding can be checked: the same arm must win
// whichever position it is shown in.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { answerClaudeCommand } from '../../test/fake-claude-cli.mjs';
import { KEYS } from './review-schema.mjs';

await answerClaudeCommand(process.argv.slice(2));
for await (const chunk of process.stdin) void chunk;
const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
const names = readdirSync(process.cwd()).filter((n) => /^solution-\d+$/.test(n)).sort();
const files = Object.fromEntries(names.map((s) => [s, count(join(process.cwd(), s))]));
const ranked = [...names].sort((a, b) => files[b] - files[a]);
const solutions = Object.fromEntries(names.map((s) => [s, { scores: Object.fromEntries(KEYS.map((k) => [k, 8 - ranked.indexOf(s)])), notes: Object.fromEntries(KEYS.map((k) => [k, `Fake review of ${k}: ${files[s]} files.`])) }]));
const review = { solutions, ship: { choice: ranked[0], why: 'Fake reviewer: it has the most files.' } };
process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: `\`\`\`json\n${JSON.stringify(review)}\n\`\`\``, session_id: '00000000-0000-4000-8000-0000000000b2', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } })}\n`);
