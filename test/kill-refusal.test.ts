// v0.7: the one refusal a plain desk gets that Claude Code itself wouldn't make: stopping programs across the computer.
import { describe, expect, it } from 'vitest';
import { machineWideStop, preToolAnswer } from '../src/runtime/kill-refusal.ts';
import { plainAnswer, plainVerdict } from '../src/runtime/plain-approvals.ts';

describe('the machine-wide kill refusal', () => {
  const refused = [
    ['bash', 'taskkill //F //IM node.exe'],
    ['bash', 'taskkill /F /IM node.exe /T'],
    ['bash', 'taskkill /FI "IMAGENAME eq node.exe"'],
    ['bash', 'pkill -f vite'],
    ['bash', 'killall node'],
    ['bash', 'kill -9 -1'],
    ['bash', 'kill -- -1'],
    ['bash', 'kill $(lsof -t -i:3000)'],
    ['bash', 'kill -9 `pgrep node`'],
    ['bash', 'fuser -k 3000/tcp'],
    ['bash', 'sudo pkill node'],
    ['bash', 'npm run build && taskkill //IM node.exe //F'],
    ['bash', 'powershell -Command "Stop-Process -Name node -Force"'],
    ['bash', 'cmd //c "taskkill /IM node.exe /F"'],
    ['bash', 'wmic process where name="node.exe" delete'],
    ['powershell', 'Stop-Process -Name node -Force'],
    ['powershell', 'Get-Process node | Stop-Process -Force'],
    ['powershell', 'Get-Process -Name node | kill'],
    // Found by the v0.7 reviews: ids found by a lookup and passed on, stops inside another shell's string, method stops.
    ['bash', 'PID=$(lsof -ti:3000); kill -9 $PID'],
    ['bash', 'for p in $(lsof -ti:3000); do kill $p; done'],
    ['bash', 'pids=$(pgrep node); kill $pids'],
    ['bash', 'bash -c "lsof -ti:3000 | xargs kill"'],
    ['bash', 'sh -c "kill -9 -1"'],
    ['bash', 'killall5 -9'],
    ['bash', 'npx kill-port 3000'],
    ['bash', 'powershell -c "gps node | spps"'],
    ['powershell', '$p=(Get-NetTCPConnection -LocalPort 3000).OwningProcess; Stop-Process -Id $p -Force'],
    ['powershell', '(Get-Process -Name node).Kill()'],
    ['powershell', 'Get-Process node | ForEach-Object { $_.Kill() }'],
  ] as const;
  for (const [dialect, command] of refused) {
    it(`refuses ${command}`, () => {
      expect(machineWideStop(command, dialect)).toBe(true);
    });
  }

  const allowed = [
    ['bash', 'kill 12345'],
    ['bash', 'kill -9 12345 12346'],
    ['bash', 'npm run dev & PID=$!; sleep 3; curl -s localhost:5173; kill $PID'],
    ['bash', 'kill %1'],
    ['bash', 'kill $(cat .dev.pid)'],
    ['bash', 'taskkill //PID 4242 //F'],
    ['bash', 'taskkill /PID 4242 /T /F'],
    ['bash', 'npm test'],
    ['powershell', 'Stop-Process -Id 4242 -Force'],
    ['powershell', 'Get-ChildItem'],
    // The usual ways a session stops what it started itself, and words that only mention a stop.
    ['powershell', '$proc = Start-Process node -ArgumentList server.js -PassThru; Start-Sleep 2; Stop-Process -Id $proc.Id -Force'],
    ['powershell', '$proc | Stop-Process'],
    ['bash', 'kill $(jobs -p)'],
    ['bash', 'grep -rn pkill src/'],
    ['bash', 'git commit -m "Stop using killall in the dev script"'],
  ] as const;
  for (const [dialect, command] of allowed) {
    it(`lets ${command} go on as Claude Code decides`, () => {
      expect(machineWideStop(command, dialect)).toBe(false);
    });
  }

  it('answers PreToolUse with a denial for a refused stop and nothing for anything else', () => {
    const denied = preToolAnswer({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'taskkill //F //IM node.exe' } }) as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(denied.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(preToolAnswer({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })).toEqual({});
    expect(preToolAnswer({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'a', content: 'pkill' } })).toEqual({});
    expect(preToolAnswer('garbage')).toEqual({});
  });
});

describe("a plain desk's prompts", () => {
  it('asks every prompt in the inbox with what Claude Code wants to do', () => {
    const v = plainVerdict({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist', description: 'Remove the build output' } });
    expect(v).toMatchObject({ verdict: 'ask', ask: { tool: 'Bash', summary: 'Claude Code asks: Run Remove the build output', detail: 'rm -rf dist' }, plan: false });
    const w = plainVerdict({ tool_name: 'Write', tool_input: { file_path: 'src/a.ts', content: 'x' } });
    expect(w).toMatchObject({ verdict: 'ask', ask: { summary: 'Claude Code asks: Change src/a.ts' } });
  });

  it("makes ExitPlanMode the plan's approval, which leaves plan mode for the job's own mode", () => {
    const v = plainVerdict({ tool_name: 'ExitPlanMode', tool_input: { plan: '# Plan\n1. Do it' } });
    expect(v).toMatchObject({ verdict: 'ask', plan: true, ask: { detail: '# Plan\n1. Do it' } });
    expect(plainAnswer(true, '', { plan: true, launch: { model: null, effort: null, permissionMode: 'acceptEdits', planFirst: true } })).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } },
    });
    expect(plainAnswer(false, 'No.', { plan: true, launch: undefined })).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'No.' } } });
  });

  it('refuses a machine-wide stop that reaches the prompt', () => {
    expect(plainVerdict({ tool_name: 'PowerShell', tool_input: { command: 'Stop-Process -Name node' } }).verdict).toBe('deny');
  });
});
