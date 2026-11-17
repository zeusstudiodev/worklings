// v0.7 (SPEC-v0.7.md, "Approvals"): a plain desk's permission prompts. Claude Code's PermissionRequest hook fires
// exactly when Claude Code would ask the person (after its hooks, rules and mode), so the office asks every one of them in
// the inbox, as the person's own terminal would, and decides none itself. The machine-wide kill is refused before it gets
// here (kill-refusal.ts, PreToolUse). Plan first's ExitPlanMode is the plan approval.
import type { ApprovalAsk } from '../core/company.ts';
import type { PlainLaunch } from '../core/plain.ts';
import { KILL_REFUSAL, machineWideStop } from './kill-refusal.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const line = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** What the session reads when it reaches for AskUserQuestion: its questions go to the person in its reply instead. */
export const ASK_IN_REPLY = 'Worklings shows your questions to the person in its inbox when you end your turn with them: write them in your reply and end the turn.';

export type PlainVerdict =
  | { verdict: 'deny'; message: string }
  | { verdict: 'ask'; ask: Pick<ApprovalAsk, 'tool' | 'summary' | 'detail' | 'kind' | 'alwaysRule'>; plan: boolean };

/** What the inbox shows for one prompt: a sentence of what Claude Code wants to do, and the exact input one click away. */
export function plainVerdict(payload: unknown): PlainVerdict {
  const p = isObj(payload) ? payload : {};
  const tool = line(p.tool_name, 120) || 'a tool';
  const input = isObj(p.tool_input) ? p.tool_input : {};
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string' && machineWideStop(input.command, tool === 'PowerShell' ? 'powershell' : 'bash')) {
    return { verdict: 'deny', message: KILL_REFUSAL };
  }
  if (tool === 'AskUserQuestion') return { verdict: 'deny', message: ASK_IN_REPLY };
  const detail = (() => {
    if (tool === 'ExitPlanMode' && typeof input.plan === 'string') return input.plan.slice(0, 20_000);
    if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string') return input.command.slice(0, 4_000);
    try {
      return JSON.stringify(input, null, 2).slice(0, 4_000);
    } catch {
      return '';
    }
  })();
  const file = line(input.file_path ?? input.notebook_path ?? input.path, 200);
  const summary = (() => {
    if (tool === 'ExitPlanMode') return 'Approve the plan and start the work';
    // Claude Code's description already says what the command does ("Run npm test", "Remove the build output"); one that
    // starts in lower case is a command itself ("npm test"), so it is run.
    if (tool === 'Bash' || tool === 'PowerShell') {
      const said = line(input.description, 160);
      return /^[A-Z]/.test(said) ? said : `Run ${said || line(input.command, 160)}`;
    }
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return file ? `Change ${file}` : `Use ${tool}`;
    if (tool === 'WebFetch') return `Fetch ${line(input.url, 200)}`;
    if (tool === 'WebSearch') return `Search the web for ${line(input.query, 160)}`;
    if (tool.startsWith('mcp__')) {
      const [, server = '', name = ''] = tool.split('__');
      return `Use ${server}: ${name.replaceAll('_', ' ')}`;
    }
    return `Use ${tool}${file ? ` on ${file}` : ''}`;
  })();
  return { verdict: 'ask', ask: { tool, summary: `Claude Code asks: ${summary}`.slice(0, 240), detail, kind: 'other', alwaysRule: null }, plan: tool === 'ExitPlanMode' };
}

/**
 * The hook's answer once the person decided. An approved plan leaves plan mode for the mode the job chose (Claude Code's
 * own default when it chose none), as the person picks one when they approve a plan in the terminal.
 */
export function plainAnswer(allow: boolean, message: string, o: { plan: boolean; launch: PlainLaunch | undefined }): object {
  const decision: Obj = allow ? { behavior: 'allow' } : { behavior: 'deny', message };
  if (allow && o.plan) decision.updatedPermissions = [{ type: 'setMode', mode: o.launch?.permissionMode ?? 'default', destination: 'session' }];
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}
