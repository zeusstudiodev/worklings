// What the benchmark never lets a run do: stop programs by name across the computer. Both arms use it (the one-prompt
// arm through no-kill-hook.mjs, the company arm by denying such approvals in run-b.mjs).
import { fileURLToPath } from 'node:url';

/** taskkill, pkill, killall, tskill, wmic process deletes, and PowerShell's Stop-Process or kill by name. */
export const MACHINE_KILL =
  /\b(taskkill|pkill|killall|tskill)\b|\bwmic\b[^\n]*\bprocess\b[^\n]*\b(delete|terminate)\b|\b(stop-process|spps|kill)\b[^\n|;&]*\s-(name|processname)\b|\bget-process\b[^\n]*\|\s*(stop-process|spps|kill)\b/i;

/**
 * Permission rules that refuse the same commands where hooks are off (the blind reviews run with disableAllHooks): a
 * review session on 15 Nov 2026 stopped every Node program on the computer, the review's own process included, twice.
 * Deny rules hold in every permission mode and whatever the hooks; they refuse the command's first word, so the shells
 * that could run one inside them are refused too.
 */
export const NO_KILL_RULES = [
  'Bash(taskkill:*)', 'Bash(tskill:*)', 'Bash(pkill:*)', 'Bash(killall:*)', 'Bash(wmic:*)', 'Bash(powershell:*)', 'Bash(powershell.exe:*)', 'Bash(pwsh:*)',
  'Bash(cmd:*)', 'Bash(cmd.exe:*)', 'PowerShell(Stop-Process:*)', 'PowerShell(spps:*)', 'PowerShell(kill:*)', 'PowerShell(taskkill:*)', 'PowerShell(tskill:*)',
  'PowerShell(wmic:*)', 'PowerShell(Get-Process:*)', 'PowerShell(cmd:*)',
];

/**
 * v0.7: settings with the product's own machine-wide kill refusal as a PreToolUse command hook (refuse-hook.mjs), so the
 * plain arm refuses exactly what the Worklings arm's office refuses.
 */
export function refusalSettings() {
  const hook = fileURLToPath(new URL('./refuse-hook.mjs', import.meta.url));
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `node "${hook.replaceAll('\\', '/')}"` }] }] } });
}

/** Settings for `claude --settings`: the hook that blocks those commands before they run, in any permission mode. */
export function noKillSettings(extra = {}) {
  const hook = fileURLToPath(new URL('./no-kill-hook.mjs', import.meta.url));
  return JSON.stringify({
    ...extra,
    hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `node "${hook.replaceAll('\\', '/')}"` }] }] },
  });
}
