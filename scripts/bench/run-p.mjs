// Arm P of the benchmark: one Claude Code session at its strongest without Worklings. It plans first in plan mode, the
// plan is approved once (as the company's plan is), and the same session then builds it with its own subagents: a code
// reviewer and a QA engineer defined with --agents from Worklings' own role texts (library/roles/), so both arms have
// the same expertise on hand, plus Claude Code's built-in general-purpose subagent for parallel parts.
//
//   node scripts/bench/run-p.mjs <task> <out>
//
// Phase 1: `claude -p --permission-mode plan` with the goal. The plan is what the session hands to ExitPlanMode (or, if
// it never calls it, its last message). Phase 2: `claude -p --resume <session> --permission-mode bypassPermissions`
// with "the plan is approved", in the same throwaway temp folder arm A uses. Both phases get the same appended system
// prompt, which tells the session to delegate and review the way a careful power user would ask it to.
//
// Environment: as run-a.mjs (BENCH_ROOT, BENCH_MODEL, BENCH_MINUTES for the whole run, WORKLINGS_CLAUDE, BENCH_FORCE),
// plus BENCH_P_PLAN_MINUTES (cap for phase 1, default 15).
//
// Saves to <out>: result.json, plan.md (the approved plan), transcript-plan.jsonl, transcript-build.jsonl,
// stderr-*.txt, agents.json (the subagents it was given), project/ and goal.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { noKillSettings } from './kill-guard.mjs';
import { claudeCommand, copyTree, environment, goalOf, leftovers, MINUTES, MODEL, now, outDir, parseJsonl, prepareStart, removeTree, REPO, requireTask, runLogged, soloEnv, usageFromStream, usageOf, writeJson, addUsage, ZERO } from './lib.mjs';

const task = requireTask(process.argv[2]);
const out = outDir(process.argv[3], 'result.json');
const goal = goalOf(task);
const PLAN_MINUTES = Number(process.env.BENCH_P_PLAN_MINUTES) > 0 ? Number(process.env.BENCH_P_PLAN_MINUTES) : 15;
writeFileSync(join(out, 'goal.txt'), `${goal}\n`);

/** A library role as a Claude Code subagent: its description, its body as the prompt, its tools. */
function agentFromRole(id) {
  const text = readFileSync(join(REPO, 'library', 'roles', `${id}.md`), 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`library/roles/${id}.md has no frontmatter`);
  const [, front, body] = match;
  const lines = front.split('\n');
  const at = lines.findIndex((l) => l.startsWith('description:'));
  const description = [];
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i += 1) description.push(lines[i].trim());
  const tools = /^tools:\s*\[(.*)\]\s*$/m.exec(front)?.[1].split(',').map((t) => t.trim()).filter(Boolean);
  return { description: description.join(' ') || lines[at].replace('description:', '').trim(), prompt: body.trim(), ...(tools ? { tools } : {}) };
}
const agents = { 'code-reviewer': agentFromRole('code-reviewer'), 'qa-engineer': agentFromRole('qa-engineer') };
const agentsFile = join(out, 'agents.json');
writeJson(agentsFile, agents);

const HOW = [
  'Work the way a strong lead engineer uses Claude Code.',
  'Plan before you build. Then delegate: run independent parts of the work in parallel through subagents (the general-purpose agent, or the code-reviewer and qa-engineer agents defined for this session), each with a clear brief: the goal, the files and what done means.',
  'Review what comes back. Before you finish, have the code-reviewer review the whole change and the qa-engineer test it the way a user would, and fix what they find.',
].join(' ');

const { command, lead, fake } = claudeCommand();
const common = [...lead, '-p', '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--agents', agentsFile, '--append-system-prompt', HOW];
// Never stop programs by name across the computer: the same hook arm A gets.
if (!fake) common.push('--settings', noKillSettings());

const folder = prepareStart(task, 'bench-p');
const env = await soloEnv();
console.log(`arm P, ${task}: ${fake ? `FAKE claude (${process.env.WORKLINGS_CLAUDE})` : 'REAL claude'} in ${folder}, cap ${MINUTES} min (plan ${PLAN_MINUTES}), model ${MODEL}`);

const startedAt = now();
const capAt = startedAt + MINUTES * 60_000;
const pids = [];

/** One phase: runs claude, then reads its stream. */
async function phase(name, args, input, minutes) {
  const transcript = join(out, `transcript-${name}.jsonl`);
  const ran = await runLogged(command, args, { cwd: folder, env, input, stdoutFile: transcript, stderrFile: join(out, `stderr-${name}.txt`), timeoutMs: Math.max(60_000, Math.min(minutes * 60_000, capAt - now())), onSpawn: (p) => pids.push(p) });
  const lines = parseJsonl(transcript);
  const final = [...lines].reverse().find((l) => l?.type === 'result') ?? null;
  const fromStream = await usageFromStream(lines);
  return { ran, lines, final, fromStream, session: final?.session_id ?? lines.find((l) => l?.session_id)?.session_id ?? null };
}

// --- phase 1: plan mode -------------------------------------------------------------------------------------------------
const planPrompt = `${goal}\n\nPlan this first, in plan mode: look at what is in the folder, then present your plan, including how you will split the work between subagents and how it will be reviewed and tested. I'll approve it before you start.`;
const p1 = await phase('plan', [...common, '--permission-mode', 'plan'], planPrompt, PLAN_MINUTES);
const exitPlan = p1.lines
  .flatMap((l) => (l?.type === 'assistant' && Array.isArray(l.message?.content) ? l.message.content : []))
  .filter((c) => c?.type === 'tool_use' && c.name === 'ExitPlanMode')
  .at(-1);
const plan = typeof exitPlan?.input?.plan === 'string' ? exitPlan.input.plan : typeof p1.final?.result === 'string' ? p1.final.result : '';
const planSource = exitPlan ? 'ExitPlanMode' : p1.final ? 'last message' : 'none';
writeFileSync(join(out, 'plan.md'), `${plan}\n`);
const planMs = now() - startedAt;

// --- phase 2: the approved plan, built --------------------------------------------------------------------------------
let p2 = null;
let failure = null;
if (!p1.session) failure = `phase 1 left no session id (exit ${p1.ran.code}${p1.ran.timedOut ? ', timed out' : ''})`;
else if (now() >= capAt) failure = 'the cap passed during planning';
else {
  const buildPrompt = 'Your plan is approved as written. Build it now and work on your own until it is done: run independent parts in parallel through subagents, then have the code-reviewer review the whole change and the qa-engineer test it as a user would, and fix what they find before you finish.';
  p2 = await phase('build', [...common, '--resume', p1.session, '--permission-mode', process.env.BENCH_A_PERMISSION || 'bypassPermissions'], buildPrompt, MINUTES);
}
const wallMs = now() - startedAt;

// --- cost ---------------------------------------------------------------------------------------------------------------
// Claude Code's reported figure for each phase, added up: a resumed `-p` session reports only its own invocation's cost
// (checked on 12 Nov 2026: phase 2 reported $0.41 against $0.31 for phase 1 and $0.32 priced from its own stream). Each
// phase's stream, priced from the office's table, is kept beside it; result.json keeps every number.
const reported = [p1.final?.total_cost_usd, p2?.final?.total_cost_usd].map((v) => (typeof v === 'number' ? v : null));
const streamCost = [p1.fromStream.cost, p2?.fromStream.cost ?? 0];
let costUsd = null;
let costKind = 'unknown';
if (reported[0] !== null && (p2 === null || reported[1] !== null)) {
  costUsd = reported[0] + (p2 === null ? 0 : reported[1]);
  costKind = 'reported';
} else if (streamCost.every((c) => typeof c === 'number')) {
  costUsd = streamCost[0] + streamCost[1];
  costKind = 'estimated-from-stream';
}
const tokens = addUsage(p1.final ? usageOf(p1.final.usage) : p1.fromStream.total, p2 ? (p2.final ? usageOf(p2.final.usage) : p2.fromStream.total) : ZERO);

// How much it delegated: Task tool calls in the build phase, by subagent type.
const delegated = {};
for (const l of p2?.lines ?? []) {
  if (l?.type !== 'assistant' || l.parent_tool_use_id || !Array.isArray(l.message?.content)) continue;
  for (const c of l.message.content) if (c?.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent')) delegated[c.input?.subagent_type ?? 'unknown'] = (delegated[c.input?.subagent_type ?? 'unknown'] ?? 0) + 1;
}

const stray = leftovers(folder);
copyTree(folder, join(out, 'project'));
const removed = removeTree(folder);
const final = p2?.final ?? null;
const capped = Boolean(p1.ran.timedOut || p2?.ran.timedOut);
const result = {
  task, arm: 'P', dryRun: fake, model: MODEL, startedAt: new Date(startedAt).toISOString(), wallMs, planMs, capped, exitCodes: [p1.ran.code, p2?.ran.code ?? null],
  sessions: [p1.session, p2?.session ?? null], claudePids: pids, costUsd, costKind, costReported: reported, costFromStream: streamCost, tokens,
  plan: { source: planSource, chars: plan.length }, delegated, turns: [p1.final?.num_turns ?? null, final?.num_turns ?? null], subtype: final?.subtype ?? null, isError: final?.is_error ?? null,
  finalText: typeof final?.result === 'string' ? final.result.slice(0, 2000) : null,
  interventions: { planApprovals: 1, total: 0 },
  done: Boolean(final) && !capped && final.is_error !== true && failure === null,
  failure, leftoverProcesses: stray, tempFolderRemoved: removed, tempFolder: removed ? null : folder,
  env: environment(),
};
writeJson(join(out, 'result.json'), result);
console.log(`${result.done ? 'done' : 'NOT DONE'} in ${(wallMs / 1000).toFixed(1)} s (plan ${(planMs / 1000).toFixed(0)} s from ${planSource}), cost ${costUsd === null ? 'unknown' : `$${costUsd.toFixed(4)}`} (${costKind}), delegated ${JSON.stringify(delegated)}, saved to ${out}`);
if (failure) console.warn(`failure: ${failure}`);
if (stray.length > 0) console.warn(`WARNING: programs still running that mention the run's folder (not stopped): ${stray.map((p) => `${p.name} ${p.pid}`).join(', ')}`);
process.exit(failure ? 1 : 0);
