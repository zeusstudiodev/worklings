// v0.7 (SPEC-v0.7.md, "Parity by construction"): how the default desk is launched, beside what plain `claude -p` gets
// from the same inputs. test/parity-contract.test.ts holds the two to exactly the differences in ALLOWED_DIFFERENCES
// (src/core/plain.ts): add a flag, append prompt text or take a tool away here and that test fails.
import type { PlainDesk, PlainLaunch } from '../core/plain.ts';

/** What both launches are given: the person's words and their choices for this job. */
export interface LaunchInputs {
  prompt: string;
  launch: PlainLaunch;
}

/** Plain Claude Code given the same choices: `claude -p` with the prompt on stdin, and the flags those choices are. */
export function plainClaudeArgs(inputs: LaunchInputs): string[] {
  return ['-p', ...choiceArgs(inputs.launch)];
}

/** The person's choices as Claude Code's own flags; nothing for what they left to Claude Code. */
export function choiceArgs(launch: PlainLaunch): string[] {
  const args: string[] = [];
  if (launch.model) args.push('--model', launch.model);
  if (launch.effort) args.push('--effort', launch.effort);
  // Plan first is Claude Code's own plan mode. Its ExitPlanMode is offered only when the run has a permission host,
  // so plan-first desks add `--permission-prompt-tool stdio` (plainDeskArgs); plain `claude -p` has no host to add.
  if (launch.planFirst) args.push('--permission-mode', 'plan');
  else if (launch.permissionMode) args.push('--permission-mode', launch.permissionMode);
  return args;
}

/** The hooks a plain desk's --settings holds, each an http hook to the hub with the desk's token from its environment. */
export interface PlainHooks {
  /** Where Claude Code's own permission prompts go: the hub puts each in the inbox. */
  permission: object;
  /** Hooks the office only hears (Stop, SubagentStop): answered at once with nothing. */
  liveness: object;
  /** PreToolUse on Bash and PowerShell: the hub refuses a machine-wide kill and lets everything else go on. */
  refusal: object;
}

/** A plain desk's --settings: the office's hooks and nothing else (no permission rules, no model, no environment). */
export function plainDeskSettings(hooks: PlainHooks): object {
  return {
    hooks: {
      PermissionRequest: [{ hooks: [hooks.permission] }],
      PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [hooks.refusal] }],
      Stop: [{ hooks: [hooks.liveness] }],
      SubagentStop: [{ hooks: [hooks.liveness] }],
    },
  };
}

/**
 * The default desk's command line after the executable. The prompt goes in as the first stream-json user message,
 * verbatim. Each flag here is either the person's own choice (choiceArgs) or one of the allowed differences.
 */
export function plainDeskArgs(o: { sessionId: string; resume: boolean; launch: PlainDesk; settingsFile: string }): string[] {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  args.push(o.resume ? '--resume' : '--session-id', o.sessionId);
  args.push(...choiceArgs(o.launch));
  if (o.launch.planFirst) args.push('--permission-prompt-tool', 'stdio');
  // The job's budget, what is left of it: Claude Code stops the session there, mid-turn too, and never steers it.
  if (typeof o.launch.budgetUsd === 'number' && Number.isFinite(o.launch.budgetUsd) && o.launch.budgetUsd > 0) args.push('--max-budget-usd', o.launch.budgetUsd.toFixed(2));
  args.push('--settings', o.settingsFile);
  return args;
}
