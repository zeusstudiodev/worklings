// A stand-in for `claude -p` for the benchmark's dry run (WORKLINGS_CLAUDE=scripts/bench/fake-solo.mjs): it calls no model
// and costs nothing. It reads the prompt on stdin, writes a deliberately weak first attempt at whichever task the prompt
// names into the current folder, and answers in the shape of `--output-format stream-json --verbose` (or json).
// The scores it earns are low on purpose: the point is that the pipeline runs end to end.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerClaudeCommand } from '../../test/fake-claude-cli.mjs';

await answerClaudeCommand(process.argv.slice(2));

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;

const write = (name, text) => {
  const file = join(process.cwd(), name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

if (/dead links/i.test(prompt)) {
  write('package.json', JSON.stringify({ name: 'fake-links', type: 'module', bin: { mdlinks: 'dist/cli.js' }, scripts: { build: 'node build.mjs' } }, null, 2));
  write('build.mjs', "import { cpSync, mkdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\ncpSync('cli.js', 'dist/cli.js');\n");
  // Weak on purpose: it finds no problems at all.
  write('cli.js', "const paths = process.argv.slice(2).filter((a) => a !== '--json');\nif (paths.length === 0) process.exit(2);\nconsole.log(JSON.stringify({ files: 0, problems: [] }));\n");
} else if (/pomodoro/i.test(prompt)) {
  write('package.json', JSON.stringify({ name: 'fake-pomodoro', type: 'module', scripts: { dev: 'node server.mjs', build: 'node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});require(\'fs\').copyFileSync(\'index.html\',\'dist/index.html\')"' } }, null, 2));
  write('server.mjs', "import { createServer } from 'node:http';\nimport { readFileSync } from 'node:fs';\nconst i = process.argv.indexOf('--port');\nconst port = Number(i > -1 ? process.argv[i + 1] : process.env.PORT || 5173);\ncreateServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(readFileSync('index.html')); }).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/`));\n");
  write('index.html', '<!doctype html><html lang="en"><head><title>Timer</title></head><body><h1>Pomodoro</h1><div>25:00</div><button>Start</button><button>Reset</button><button>Skip</button></body></html>\n');
} else if (/spanwise/i.test(prompt)) {
  // The feature, wrong on purpose: it returns the window whatever is busy.
  write('src/gaps.ts', "import type { DateRange } from './range';\nexport function findGaps(_busy: readonly DateRange[], window: DateRange): DateRange[] {\n  return [window];\n}\n");
  const fs = await import('node:fs');
  fs.appendFileSync(join(process.cwd(), 'src', 'index.ts'), "export { findGaps } from './gaps';\n");
}

const text = 'Fake solo session: wrote a weak first attempt and stopped.';
const session = '00000000-0000-4000-8000-0000000000a1';
const usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const result = {
  type: 'result', subtype: 'success', is_error: false, duration_ms: 1500, duration_api_ms: 1200, num_turns: 3, result: text,
  session_id: session, total_cost_usd: 0.0123, usage, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1200, outputTokens: 300, costUSD: 0.0123 } },
};
const format = flag('--output-format');
if (format === 'stream-json') {
  const lines = [
    { type: 'system', subtype: 'init', session_id: session, model: flag('--model') ?? 'sonnet', cwd: process.cwd() },
    { type: 'assistant', message: { id: 'msg_fake1', model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text }], usage }, session_id: session },
    result,
  ];
  for (const l of lines) process.stdout.write(`${JSON.stringify(l)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
