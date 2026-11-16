// Arm A of the benchmark: one `claude -p` session with the goal, in a fresh temp folder, Sonnet, no follow-up.
//
//   node scripts/bench/run-a.mjs <task> <out>
//
// Environment:
//   BENCH_ROOT        where the tasks live (default: worklings-bench in your home folder)
//   BENCH_MODEL       the model alias (default sonnet)
//   BENCH_MINUTES     wall-time cap in minutes (default 45); a run that hits it is killed and marked capped
//   BENCH_A_PERMISSION  --permission-mode (default bypassPermissions: a headless session can't answer prompts, and the
//                     folder is a throwaway temp folder; the company's desks get the same effect through the approvals hook)
//   BENCH_A_EXTRA_ARGS  extra arguments for claude, space separated
//   BENCH_A_SETUP     neutral (default, v0.4's B1) or user. Neutral isolates the session the way a company's lean desk
//                     is: --setting-sources project,local (no user CLAUDE.md, settings, skills or plugins),
//                     --strict-mcp-config with an empty MCP config, ENABLE_CLAUDEAI_MCP_SERVERS=false. "user" is arm A+:
//                     the person's own Claude Code setup, as v0.3 ran it, for reference only.
//   BENCH_EFFORT      --effort for the session. Neutral defaults to what the product's Balanced Builder runs at
//                     (src/core/presets.ts); user runs at the user's own effortLevel unless this is set.
//   WORKLINGS_CLAUDE  the executable instead of `claude`: always set it in a dry run, or the run spends money
//   BENCH_FORCE=1     overwrite an existing run in <out>
//
// Saves to <out>: result.json (cost, tokens, wall time, versions), transcript.jsonl (the stream), stderr.txt,
// project/ (the folder it produced, without node_modules) and goal.txt.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { noKillSettings } from './kill-guard.mjs';
import { armSetup, claudeCommand, copyTree, environment, goalOf, leftovers, loadedSetup, MINUTES, MODEL, now, outDir, parseJsonl, prepareStart, removeTree, requireTask, runLogged, soloEnv, usageFromStream, usageOf, writeJson } from './lib.mjs';

const task = requireTask(process.argv[2]);
const out = outDir(process.argv[3], 'result.json');
const goal = goalOf(task);
writeFileSync(join(out, 'goal.txt'), `${goal}\n`);

const folder = prepareStart(task, 'bench-a');
const { command, lead, fake } = claudeCommand();
const setup = await armSetup(out);
const args = [...lead, '-p', '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--permission-mode', process.env.BENCH_A_PERMISSION || 'bypassPermissions', ...setup.args];
// Never stop programs by name across the computer (a session once ran `taskkill //F //IM node.exe`): a hook blocks it.
if (!fake) args.push('--settings', noKillSettings(setup.settings));
if (process.env.BENCH_A_EXTRA_ARGS) args.push(...process.env.BENCH_A_EXTRA_ARGS.split(/\s+/).filter(Boolean));

console.log(`arm A, ${task}: ${fake ? `FAKE claude (${process.env.WORKLINGS_CLAUDE})` : 'REAL claude'} in ${folder}, cap ${MINUTES} min, model ${MODEL}, setup ${setup.setup}, effort ${setup.effort}`);
const startedAt = now();
let pid = null;
// The prompt goes on stdin, as Worklings gives its own: no shell ever splits it.
const ran = await runLogged(command, args, {
  cwd: folder,
  env: { ...(await soloEnv()), ...setup.env },
  input: goal,
  stdoutFile: join(out, 'transcript.jsonl'),
  stderrFile: join(out, 'stderr.txt'),
  timeoutMs: MINUTES * 60_000,
  onSpawn: (p) => {
    pid = p;
  },
});
const wallMs = now() - startedAt;

const lines = parseJsonl(join(out, 'transcript.jsonl'));
const final = [...lines].reverse().find((l) => l?.type === 'result') ?? null;
let tokens;
let costUsd;
let costKind;
if (final) {
  tokens = usageOf(final.usage);
  costUsd = typeof final.total_cost_usd === 'number' ? final.total_cost_usd : null;
  costKind = costUsd === null ? 'unknown' : 'reported';
} else {
  // Cut off (cap or crash) before the result line: add up the assistant messages and price them with the office's table.
  const sum = await usageFromStream(lines);
  tokens = sum.total;
  costUsd = sum.cost;
  costKind = sum.cost === null ? 'unknown' : 'estimated-from-stream';
}

// Programs the session started and left running: reported with their PIDs, never killed here.
const stray = leftovers(folder);
copyTree(folder, join(out, 'project'));
const removed = removeTree(folder);

const result = {
  task, arm: 'A', dryRun: fake, model: MODEL, effort: setup.effort, setup: { kind: setup.setup, args: setup.shown, loaded: loadedSetup(lines) }, startedAt: new Date(startedAt).toISOString(), wallMs, capped: ran.timedOut, exitCode: ran.code,
  spawnError: ran.error, claudePid: pid, costUsd, costKind, tokens, turns: final?.num_turns ?? null, subtype: final?.subtype ?? null, isError: final?.is_error ?? null,
  finalText: typeof final?.result === 'string' ? final.result.slice(0, 2000) : null,
  interventions: { total: 0 },
  done: Boolean(final) && !ran.timedOut && final.is_error !== true,
  leftoverProcesses: stray, tempFolderRemoved: removed, tempFolder: removed ? null : folder,
  env: environment(),
};
writeJson(join(out, 'result.json'), result);
console.log(`done in ${(wallMs / 1000).toFixed(1)} s, cost ${costUsd === null ? 'unknown' : `$${costUsd.toFixed(4)}`} (${costKind}), capped ${result.capped}, saved to ${out}`);
if (stray.length > 0) console.warn(`WARNING: programs still running that mention the run's folder (not stopped): ${stray.map((p) => `${p.name} ${p.pid}`).join(', ')}`);
process.exit(ran.error ? 1 : 0);
