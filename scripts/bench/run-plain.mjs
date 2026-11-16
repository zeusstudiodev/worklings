// v0.7's plain arm: `claude -p` with the goal, in a fresh copy of the task's starting point, through the bench's profile.
//
//   node scripts/bench/run-plain.mjs <task> <out>
//
// Environment: BENCH_ROOT, BENCH_MODEL (sonnet), BENCH_MINUTES, BENCH_FORCE as run-a.mjs; BENCH_PROFILE (blank|user),
// BENCH_PERMISSION (bypassPermissions) and BENCH_ANSWER_QUESTIONS (parity-lib.mjs). No --effort: Claude Code's default.
// The product's machine-wide kill refusal runs as a PreToolUse command hook (refuse-hook.mjs), so it refuses exactly what the
// Worklings arm's office refuses.
// When the session ends its turn with questions and answers are on, the same session is resumed once with ANSWER.
//
// Saves to <out>: result.json (cost, wall time, prompts), transcript.jsonl (and transcript-2.jsonl after an answer),
// stderr.txt, project/ (what it produced, without node_modules) and goal.txt.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusalSettings } from './kill-guard.mjs';
import { machineWideStop } from '../../src/runtime/kill-refusal.ts';
import { copyTree, environment, goalOf, leftovers, stopRecorded, watchTree, loadedSetup, MINUTES, MODEL, now, outDir, parseJsonl, prepareStart, removeTree, requireTask, runLogged, soloEnv, writeJson } from './lib.mjs';
import { ANSWER, ANSWERS, asksQuestions, lastWords, PERMISSION, PROFILE, PROFILE_CLAUDE } from './parity-lib.mjs';

const task = requireTask(process.argv[2]);
const out = outDir(process.argv[3], 'result.json');
const goal = goalOf(task);
writeFileSync(join(out, 'goal.txt'), `${goal}\n`);
const folder = prepareStart(task, 'bench-p');
const flags = ['--model', MODEL, '--output-format', 'stream-json', '--verbose', '--permission-mode', PERMISSION, '--settings', refusalSettings()];
const env = { ...(await soloEnv()), BENCH_PROFILE: PROFILE, BENCH_PROFILE_LOG: join(out, 'launches.jsonl') };
console.log(`plain arm, ${task}: claude -p in ${folder}, profile ${PROFILE}, model ${MODEL}, mode ${PERMISSION}, cap ${MINUTES} min`);

const startedAt = now();
const turns = [];
const stoppedAfter = [];
let sessionId = null;
let capped = false;
for (const [i, input] of [goal, ANSWER].entries()) {
  if (i === 1 && !(ANSWERS && asksQuestions(lastWords(turns[0]?.text)))) break;
  const left = startedAt + MINUTES * 60_000 - now();
  if (left <= 0) break;
  const file = join(out, i === 0 ? 'transcript.jsonl' : 'transcript-2.jsonl');
  const args = [PROFILE_CLAUDE, '-p', ...(i === 0 ? [] : ['--resume', sessionId]), ...flags];
  let tree = null;
  const ran = await runLogged(process.execPath, args, { cwd: folder, env, input, stdoutFile: file, stderrFile: join(out, i === 0 ? 'stderr.txt' : 'stderr-2.txt'), timeoutMs: left, onSpawn: (pid) => (tree = watchTree(pid)) });
  // What the session started and left running when it ended: stopped by the PIDs recorded while it ran.
  if (tree) stoppedAfter.push(...stopRecorded(tree.stop()));
  const lines = parseJsonl(file);
  const final = [...lines].reverse().find((l) => l?.type === 'result') ?? null;
  sessionId = final?.session_id ?? lines.find((l) => l?.type === 'system' && l.subtype === 'init')?.session_id ?? sessionId;
  turns.push({
    costUsd: typeof final?.total_cost_usd === 'number' ? final.total_cost_usd : null,
    text: typeof final?.result === 'string' ? final.result : null,
    subtype: final?.subtype ?? null,
    // What Claude Code would have asked the person: its denials, less the kill refusals both arms make the same way.
    denials: Array.isArray(final?.permission_denials) ? final.permission_denials.filter((d) => !(typeof d?.tool_input?.command === 'string' && machineWideStop(d.tool_input.command, d.tool_name === 'PowerShell' ? 'powershell' : 'bash'))).length : 0,
    exitCode: ran.code,
    setup: i === 0 ? loadedSetup(lines) : undefined,
  });
  if (ran.timedOut) {
    capped = true;
    break;
  }
}
const wallMs = now() - startedAt;
const stray = leftovers(folder);
copyTree(folder, join(out, 'project'));
const removed = removeTree(folder);
const costUsd = turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
const result = {
  task, arm: 'P', profile: PROFILE, model: MODEL, permission: PERMISSION, effort: 'Claude Code default', startedAt: new Date(startedAt).toISOString(), wallMs, capped,
  costUsd, costKnown: turns.every((t) => t.costUsd !== null), turns: turns.map(({ text, ...t }) => ({ ...t, text: text?.slice(0, 2000) ?? null })),
  prompts: { questionsAnswered: turns.length - 1, permissionDenials: turns.reduce((n, t) => n + t.denials, 0) },
  done: turns.length > 0 && !capped && turns.at(-1)?.subtype === 'success',
  leftoverProcesses: stray, stoppedAfter, tempFolderRemoved: removed, env: environment(),
};
writeJson(join(out, 'result.json'), result);
console.log(`done in ${(wallMs / 1000).toFixed(1)} s, $${costUsd.toFixed(4)}, turns ${turns.length}, capped ${capped}`);
if (stray.length > 0) console.warn(`WARNING: programs still running that mention the run's folder (not stopped): ${stray.map((p) => `${p.name} ${p.pid}`).join(', ')}`);
