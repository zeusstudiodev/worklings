// Stopping a program: what a desk itself started is its own to stop, by its process id and nothing else. A stop by
// name, port, pattern, job or group, of a number the command works out as it runs, or of any other process still goes
// to the stakeholder. (A benchmark's makers left `npm start` running because every stop asked and was declined, and
// then spent turns on the stray servers.)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPermission, type PermissionVerdict, type PolicyOptions, stopsByPid } from '../src/runtime/approvals.ts';
import { tempDir } from './library-kit.ts';

let root = '';
let home = '';
let tmp = '';
/** What the office recorded for this desk: two servers it started. */
const OWN = [62504, 50768];

beforeAll(() => {
  const dir = tempDir('worklings-stops-');
  root = join(dir, 'tool-library');
  home = join(dir, 'home');
  tmp = join(dir, 'tmp');
  for (const d of [join(root, 'src'), home, tmp]) mkdirSync(d, { recursive: true });
});

const policy = (o: Partial<PolicyOptions> = {}): PolicyOptions => ({ root, branch: null, rules: [], home, tmp, ownProcesses: OWN, ...o });
const run = (tool: 'Bash' | 'PowerShell', command: string, o?: Partial<PolicyOptions>) =>
  classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: { command }, cwd: root }, policy(o));
const bash = (command: string, o?: Partial<PolicyOptions>) => run('Bash', command, o);
const powershell = (command: string, o?: Partial<PolicyOptions>) => run('PowerShell', command, o);
const STOP = 'Stop a program that is running on the computer';
const asksToStop = (v: PermissionVerdict) => v.verdict === 'ask' && v.summary.startsWith(STOP);

describe("a stop of the desk's own process, by its id, needs nobody", () => {
  it.each([
    'taskkill //PID 62504 //F',
    'taskkill /PID 62504 /F',
    'taskkill /F /T /PID 62504',
    'taskkill -pid 62504 -f',
    'taskkill //PID 62504 //PID 50768 //F',
    'taskkill //PID 62504 //F; sleep 1; echo done',
    'taskkill.exe /PID 50768 /F',
  ])('taskkill, in Git Bash on Windows: %s', (command) => {
    expect(bash(command, { platform: 'win32' })).toEqual({ verdict: 'allow' });
  });

  it.each([
    'Stop-Process -Id 62504',
    'Stop-Process -Id 62504 -Force',
    'Stop-Process -Id 62504,50768 -Force',
    'Stop-Process -Id 62504, 50768 -Force',
    'Stop-Process 62504 -Force',
    'stop-process -id 62504 -force -ErrorAction SilentlyContinue',
    'spps -Id 50768',
    'kill 62504 -Force',
    'taskkill /PID 62504 /F',
  ])('Stop-Process and its aliases, in PowerShell: %s', (command) => {
    expect(powershell(command, { platform: 'win32' })).toEqual({ verdict: 'allow' });
  });

  it('Stop-Process inside a PowerShell that Bash starts', () => {
    expect(bash('powershell -NoProfile -Command "Stop-Process -Id 50768,62504 -Force"', { platform: 'win32' })).toEqual({ verdict: 'allow' });
  });

  it.each(['kill 62504', 'kill -9 62504', 'kill -KILL 62504 50768', 'kill -s TERM 62504', 'kill -n 15 62504', 'kill -- 62504', 'kill -TERM -- 62504'])(
    'kill, where the shell counts processes as the system does: %s',
    (command) => {
      expect(bash(command, { platform: 'linux' })).toEqual({ verdict: 'allow' });
      expect(bash(command, { platform: 'darwin' })).toEqual({ verdict: 'allow' });
    },
  );

  it('stays one part of a chain: the rest of the command is still judged', () => {
    expect(bash('taskkill //PID 62504 //F && npm test', { platform: 'win32' })).toEqual({ verdict: 'allow' });
    const v = bash('taskkill //PID 62504 //F && git push origin main', { platform: 'win32' });
    expect(v.verdict).toBe('ask');
    expect(asksToStop(v)).toBe(false);
  });
});

describe('every other stop still asks', () => {
  it.each([
    ['another process, by its id', 'taskkill //PID 4242 //F'],
    ['one of its own and one that is not', 'taskkill //PID 62504 //PID 4242 //F'],
    ['by image name', 'taskkill //F //IM node.exe'],
    ['by image name beside its own id', 'taskkill //PID 62504 //IM node.exe //F'],
    ['by a filter', 'taskkill //FI "WINDOWTITLE eq server" //F'],
    ['on another computer', 'taskkill //S build-box //PID 62504 //F'],
    ['an id the command works out from a port', "PID=$(netstat -ano | grep -E ':3111\\s.*LISTENING' | awk '{print $5}' | head -1); taskkill //PID $PID //F"],
    ['an id from a file', 'taskkill //PID $(cat server.pid) //F'],
    ['no id at all', 'taskkill //F'],
    ['id 0', 'taskkill //PID 0 //F'],
    ['by pattern', 'pkill -f "dist/index.js"'],
    ['by name', 'killall node'],
    ['whatever holds a port', 'fuser -k 3000/tcp'],
  ])('%s: %s', (_what, command) => {
    expect(asksToStop(bash(command, { platform: 'win32' }))).toBe(true);
  });

  it('by port through a package: asks as any package the project does not have', () => {
    expect(bash('npx kill-port 3000', { platform: 'win32' }).verdict).toBe('ask');
  });

  it("kill in Git Bash on Windows, whose numbers are MSYS's own and not the system's", () => {
    for (const command of ['kill 62504', 'kill -9 62504', 'kill -- 62504']) expect(asksToStop(bash(command, { platform: 'win32' }))).toBe(true);
  });

  it.each([
    ['another process', 'kill 4242'],
    ['its own and another', 'kill -9 62504 4242'],
    ['a process group', 'kill -- -62504'],
    ['a process group, by a negative id', 'kill -9 -62504'],
    ['every process it may signal', 'kill -9 -1'],
    ['its own process group', 'kill 0'],
    ['a job', 'kill %1'],
    ['the last background job, by a variable', 'kill $!'],
    ['an id from a file', 'kill $(cat server.pid)'],
    ['an id from a port', 'kill $(lsof -ti :3000)'],
    ['a signal and no process', 'kill -9'],
    ['a listing flag', 'kill -l 62504'],
  ])('kill off Windows, %s: %s', (_what, command) => {
    expect(asksToStop(bash(command, { platform: 'linux' }))).toBe(true);
  });

  it.each([
    ['another process', 'Stop-Process -Id 4242 -Force'],
    ['its own and another', 'Stop-Process -Id 62504,4242 -Force'],
    ['by name', 'Stop-Process -Name node -Force'],
    ['by name beside its own id', 'Stop-Process -Id 62504 -Name node'],
    ['whatever a pipeline finds', 'Get-Process node | Stop-Process -Force'],
    ['whatever holds a port', 'Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force'],
    ['an id in a variable', 'Stop-Process -Id $serverPid -Force'],
    ['an object', 'Stop-Process -InputObject $server'],
    ['no id at all', 'Stop-Process -Force'],
  ])('Stop-Process, %s: %s', (_what, command) => {
    expect(asksToStop(powershell(command, { platform: 'win32' }))).toBe(true);
  });

  it('the id of another desk, as a CEO would stop a report’s stray server', () => {
    const v = bash('powershell -NoProfile -Command "Stop-Process -Id 50768,49512 -Force"', { platform: 'win32', ownProcesses: [] });
    expect(asksToStop(v)).toBe(true);
  });

  it('everything, for a desk the office recorded nothing for', () => {
    for (const own of [undefined, [], [0, -1, 1.5, Number.NaN]]) {
      expect(asksToStop(bash('taskkill //PID 62504 //F', { platform: 'win32', ownProcesses: own }))).toBe(true);
      expect(asksToStop(bash('kill 62504', { platform: 'linux', ownProcesses: own }))).toBe(true);
    }
  });

  it('keeps the exact Always allow rule for a stop that asks', () => {
    const v = bash('taskkill //PID 4242 //F', { platform: 'win32' });
    expect(v).toMatchObject({ verdict: 'ask', kind: 'other', alwaysRule: { rule: 'Bash(taskkill //PID 4242 //F)' } });
  });
});

describe('which requests the hub reads a desk’s processes for', () => {
  const request = (tool_name: string, command: unknown) => ({ hook_event_name: 'PermissionRequest', tool_name, tool_input: { command } });

  it('a Bash or PowerShell command that names a program that stops others', () => {
    expect(stopsByPid(request('Bash', 'taskkill //PID 62504 //F'))).toBe(true);
    expect(stopsByPid(request('Bash', 'npm test; kill 123'))).toBe(true);
    expect(stopsByPid(request('PowerShell', 'Stop-Process -Id 1 -Force'))).toBe(true);
    expect(stopsByPid(request('Bash', 'powershell -Command "spps 4"'))).toBe(true);
  });

  it('nothing else', () => {
    expect(stopsByPid(request('Bash', 'npm test'))).toBe(false);
    expect(stopsByPid(request('Bash', 'echo skill && cat killer.txt'))).toBe(false);
    expect(stopsByPid(request('Write', 'kill 1'))).toBe(false);
    expect(stopsByPid(request('Bash', 42))).toBe(false);
    expect(stopsByPid(null)).toBe(false);
    expect(stopsByPid({ tool_name: 'Bash' })).toBe(false);
  });
});
