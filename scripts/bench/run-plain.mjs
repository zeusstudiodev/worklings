// v0.7's plain arm: `claude -p` with the goal, in a fresh copy of the task's starting point, through the bench's profile.
//
//   node scripts/bench/run-plain.mjs <task> <out>
//
// Environment: BENCH_ROOT, BENCH_MODEL (sonnet), BENCH_MINUTES, BENCH_FORCE as run-a.mjs; BENCH_PROFILE (blank|user),
// BENCH_PERMISSION (bypassPermissions) and BENCH_ANSWER_QUESTIONS (parity-lib.mjs). No --effort: Claude Code's default.
// The product's machine-wide kill refusal runs as a PreToolUse command hook (refuse-hook.mjs), so it refuses exactly what the
// Worklings arm's office refuses.
// When the session ends its turn with questions and answers are on, the same session is resumed once with ANSWER.
// v0.9 (SPEC-v0.9.md): BENCH_PACKS (comma-separated pack ids) adds those packs to the folder through Worklings' own
// installer before the run, committed as a second commit; BENCH_GOAL names another goal file (goal-short.md);
// BENCH_ANSWER_QUESTIONS=stakeholder answers, up to BENCH_ANSWERS_MAX times, with a stand-in who knows the full request.
//
// Saves to <out>: result.json (cost, wall time, prompts), transcript.jsonl (and transcript-<n>.jsonl after each answer),
// stderr.txt, project/ (what it produced, without node_modules) and goal.txt.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_KILL_RULES, refusalSettings } from './kill-guard.mjs';
import { machineWideStop } from '../../src/runtime/kill-refusal.ts';
import { cleanPackIds } from '../../src/core/packs.ts';
import { installPacks } from '../../src/packs/install.ts';
import { commitAll, copyTree, environment, goalOf, leftovers, stopRecorded, watchTree, loadedSetup, MINUTES, MODEL, now, outDir, parseJsonl, prepareStart, removeTree, requireTask, runLogged, sh, soloEnv, writeJson } from './lib.mjs';
import { ANSWER, ANSWERS, ANSWERS_MAX, asksQuestions, lastWords, PERMISSION, PROFILE, PROFILE_CLAUDE, STAKEHOLDER, stakeholderPrompt } from './parity-lib.mjs';

const task = requireTask(process.argv[2]);
const out = outDir(process.argv[3], 'result.json');
const GOAL_FILE = process.env.BENCH_GOAL || 'goal.md';
const goal = goalOf(task, GOAL_FILE);
const fullGoal = goalOf(task);
writeFileSync(join(out, 'goal.txt'), `${goal}\n`);
const packs = cleanPackIds((process.env.BENCH_PACKS ?? '').split(',').map((p) => p.trim()).filter(Boolean));
if (!packs.ok) throw new Error(packs.message);
const folder = prepareStart(task, 'bench-p');
if (packs.ids.length > 0) {
  installPacks(folder, packs.ids);
  commitAll(folder, 'Packs');
}
const flags = ['--model', MODEL, '--output-format', 'stream-json', '--verbose', '--permission-mode', PERMISSION, '--settings', refusalSettings()];
const env = { ...(await soloEnv()), BENCH_PROFILE: PROFILE, BENCH_PROFILE_LOG: join(out, 'launches.jsonl') };
console.log(`plain arm, ${task}: claude -p in ${folder}, profile ${PROFILE}, model ${MODEL}, mode ${PERMISSION}, cap ${MINUTES} min, packs ${packs.ids.join(',') || 'none'}, goal ${GOAL_FILE}`);

/** Whether the project has no changes since its starting commits. */
const changedNothing = () => {
  const ran = sh('git', ['status', '--porcelain'], { cwd: folder, timeoutMs: 60_000 });
  return ran.code === 0 && ran.stdout.trim() === '';
};

/** The stand-in's reply to the session's last words: Sonnet, no tools, a neutral empty folder, the blank profile. */
async function stakeholderReply(words, i) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-person-'));
  const file = join(out, `person-${i}.json`);
  await runLogged(process.execPath, [PROFILE_CLAUDE, '-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--disallowedTools', ...NO_KILL_RULES], {
    cwd: dir, env: { ...env, BENCH_PROFILE: 'blank' }, input: stakeholderPrompt(goal, fullGoal, words), stdoutFile: file, stderrFile: join(out, `person-${i}.err.txt`), timeoutMs: 5 * 60_000,
  });
  removeTree(dir);
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return { text: typeof j.result === 'string' && j.result.trim() ? j.result.trim() : ANSWER, costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : 0 };
  } catch {
    return { text: ANSWER, costUsd: 0 };
  }
}

const startedAt = now();
const turns = [];
const answers = [];
const stoppedAfter = [];
let sessionId = null;
let capped = false;
for (let i = 0; i <= ANSWERS_MAX; i++) {
  let input = goal;
  if (i > 0) {
    const before = turns[i - 1];
    const words = lastWords(before?.text);
    if (!ANSWERS || before?.subtype !== 'success') break;
    if (!(asksQuestions(words) || (STAKEHOLDER && changedNothing()))) break;
    if (STAKEHOLDER) {
      const reply = await stakeholderReply(words ?? '', i);
      answers.push({ after: i, asked: (words ?? '').slice(-1500), reply: reply.text, costUsd: reply.costUsd });
      input = reply.text;
    } else input = ANSWER;
  }
  const left = startedAt + MINUTES * 60_000 - now();
  if (left <= 0) break;
  const file = join(out, i === 0 ? 'transcript.jsonl' : `transcript-${i + 1}.jsonl`);
  const args = [PROFILE_CLAUDE, '-p', ...(i === 0 ? [] : ['--resume', sessionId]), ...flags];
  let tree = null;
  const ran = await runLogged(process.execPath, args, { cwd: folder, env, input, stdoutFile: file, stderrFile: join(out, i === 0 ? 'stderr.txt' : `stderr-${i + 1}.txt`), timeoutMs: left, onSpawn: (pid) => (tree = watchTree(pid)) });
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
const jobCostUsd = turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
const answerCostUsd = answers.reduce((sum, a) => sum + a.costUsd, 0);
// costUsd is everything the run spent (the bench's spend cap counts it); jobCostUsd is the session's alone.
const costUsd = jobCostUsd + answerCostUsd;
const result = {
  task, arm: 'P', profile: PROFILE, model: MODEL, permission: PERMISSION, effort: 'Claude Code default', startedAt: new Date(startedAt).toISOString(), wallMs, capped,
  goalFile: GOAL_FILE, packs: packs.ids, answers, jobCostUsd, answerCostUsd,
  costUsd, costKnown: turns.every((t) => t.costUsd !== null), turns: turns.map(({ text, ...t }) => ({ ...t, text: text?.slice(0, 2000) ?? null })),
  prompts: { questionsAnswered: turns.length - 1, permissionDenials: turns.reduce((n, t) => n + t.denials, 0) },
  done: turns.length > 0 && !capped && turns.at(-1)?.subtype === 'success',
  leftoverProcesses: stray, stoppedAfter, tempFolderRemoved: removed, env: environment(),
};
writeJson(join(out, 'result.json'), result);
console.log(`done in ${(wallMs / 1000).toFixed(1)} s, $${costUsd.toFixed(4)}, turns ${turns.length}, capped ${capped}`);
if (stray.length > 0) console.warn(`WARNING: programs still running that mention the run's folder (not stopped): ${stray.map((p) => `${p.name} ${p.pid}`).join(', ')}`);
