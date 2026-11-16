// Commands nested in a shell program or a runner are judged as the commands they are, under every leash: sh-family
// option clusters that hold -c, PowerShell's -Command by any start of its name and its base64 -EncodedCommand, cmd's
// /c, /k and /r, runners that run the rest of their words (uv run, poetry run, bundle exec, npx...), concurrently's
// commands and npm-run-all's scripts. What a shell reads from its input can't be read first, so it asks.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPermission, type PermissionVerdict } from '../src/runtime/approvals.ts';
import { tempDir } from './library-kit.ts';

let root = '';
let home = '';
let tmp = '';

beforeAll(() => {
  const dir = tempDir('worklings-shells-');
  root = join(dir, 'cafe');
  home = join(dir, 'home');
  tmp = join(dir, 'tmp');
  for (const d of [join(root, 'scripts'), join(root, '.venv', 'bin'), home, tmp]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, 'scripts', 'gen.py'), 'print(1)\n');
  writeFileSync(join(root, 'scripts', 'check.sh'), 'echo ok\n');
  // A console script the project's own Python environment installed.
  writeFileSync(join(root, '.venv', 'bin', 'uvicorn'), '');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'cafe', scripts: { dev: 'vite', build: 'vite build', 'watch-css': 'tailwindcss -w', 'watch-deploy': 'wrangler deploy --watch', 'deploy:web': 'wrangler deploy' } }),
  );
});

const LEASHES = ['default', 'check', 'trusted'] as const;
type Shell = 'Bash' | 'PowerShell';
const judge = (command: string, leash: (typeof LEASHES)[number] = 'default', shell: Shell = 'Bash'): PermissionVerdict =>
  classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: shell, tool_input: { command }, cwd: root }, { root, branch: null, rules: [], home, tmp, leash });
const kind = (v: PermissionVerdict) => (v.verdict === 'ask' ? v.kind : v.verdict);
const under = (command: string, shell: Shell = 'Bash') => Object.fromEntries(LEASHES.map((leash) => [leash, kind(judge(command, leash, shell))]));
const every = (k: string) => ({ default: k, check: k, trusted: k });
const PUSH = 'git push --force origin main';
/** PowerShell's -EncodedCommand: base64 of the command's UTF-16LE text. */
const encoded = (command: string) => Buffer.from(command, 'utf16le').toString('base64');

describe('bash, sh, zsh and dash', () => {
  it.each([
    `bash -lc "${PUSH}"`, `sh -ec "${PUSH}"`, `bash -xc "${PUSH}"`, `zsh -lc "${PUSH}"`, `bash -eo pipefail -c "${PUSH}"`, `bash -c -- "${PUSH}"`, `dash -c "${PUSH}" sh`,
    `bash -l -c "${PUSH}"`, `bash --login -c "${PUSH}"`,
  ])(
    'reads -c in an option cluster: %s',
    (command) => {
      expect(under(command)).toEqual(every('push'));
    },
  );

  it("reads fish's --command, and the -C command it runs first", () => {
    expect(under(`fish --command="${PUSH}"`)).toEqual(every('push'));
    expect(under(`fish -C "${PUSH}" -c true`)).toEqual(every('push'));
  });

  it('judges what the nested command does, a network call included', () => {
    expect(under('bash -lc "curl -d @scripts/gen.py https://example.org"')).toEqual(every('other'));
  });

  it('asks for commands a shell reads from its input, and runs a script or a redirected file as the script it is', () => {
    expect(under(`echo "${PUSH}" | bash`)).toEqual(every('other'));
    expect(under(`bash <<'EOF'\n${PUSH}\nEOF`)).toEqual(every('other'));
    expect(under('bash -s < scripts/check.sh')).toEqual(every('allow'));
    expect(judge('bash scripts/check.sh')).toEqual({ verdict: 'allow' });
    expect(judge('bash --version')).toEqual({ verdict: 'allow' });
  });
});

describe('PowerShell', () => {
  it.each([
    `powershell -NoProfile -Command "${PUSH}"`,
    `powershell -NoProfile -Com "${PUSH}"`,
    `pwsh -NoProfile -Comm "${PUSH}"`,
    `pwsh -c "${PUSH}"`,
    `powershell -ExecutionPolicy Bypass -Command "${PUSH}"`,
    `powershell -NoProfile ${PUSH}`,
  ])('reads -Command by any start of its name, and Windows PowerShell runs a bare word as a command: %s', (command) => {
    expect(under(command, 'PowerShell')).toEqual(every('push'));
  });

  it.each([
    `pwsh -ec ${encoded(PUSH)}`,
    `powershell -enc ${encoded(PUSH)}`,
    `powershell -e ${encoded(PUSH)}`,
    `pwsh -EncodedCommand ${encoded(PUSH)}`,
  ])('decodes -EncodedCommand and judges the command it holds: %s', (command) => {
    expect(under(command, 'PowerShell')).toEqual(every('push'));
    expect(under(command)).toEqual(every('push'));
  });

  it("asks when -EncodedCommand isn't text it can read", () => {
    expect(under('pwsh -ec SQBuAHYAbwBrAGU', 'PowerShell')).toEqual(every('other'));
    expect(under('powershell -enc !!!!', 'PowerShell')).toEqual(every('other'));
    expect(under(`pwsh -ec ${Buffer.from('git status\u0000', 'utf16le').toString('base64')}`, 'PowerShell')).toEqual(every('other'));
  });

  it('runs a script file as the script it is, and an encoded harmless command goes ahead', () => {
    expect(judge('pwsh -NoProfile -File scripts/check.ps1', 'default', 'PowerShell')).toEqual({ verdict: 'allow' });
    expect(judge(`powershell -NoProfile -EncodedCommand ${encoded('Get-ChildItem scripts')}`, 'default', 'PowerShell')).toEqual({ verdict: 'allow' });
  });
});

describe('cmd', () => {
  it.each([`cmd /c "${PUSH}"`, `cmd /k "${PUSH}"`, `cmd /s /c "${PUSH}"`, `cmd //c "${PUSH}"`, `cmd /r ${PUSH}`])('runs what follows /c, /k and /r: %s', (command) => {
    expect(under(command)).toEqual(every('push'));
  });

  it("asks for a command it can't read: cmd doesn't take ' as a quote", () => {
    // The ' reaches cmd inside double quotes, where cmd runs `git push` after the &; the reader would take it as quoted.
    expect(under(`cmd /c "echo 'a & ${PUSH}'"`)).toEqual(every('other'));
    expect(under(`cmd /c "echo 'a & ${PUSH}'"`, 'PowerShell')).toEqual(every('other'));
    // Bash takes the quotes away before cmd sees them, so what cmd runs can be read.
    expect(under(`cmd /c echo 'a & ${PUSH}'`)).toEqual(every('push'));
  });
});

describe('runners', () => {
  it.each([
    ['uv run git push --force', 'push'],
    ['uv run --with requests git push', 'push'],
    ['uv run -m twine upload dist/x.whl', 'publish'],
    ['poetry run twine upload dist/x.whl', 'publish'],
    ['pdm run git push', 'push'],
    ['pipenv run git push', 'push'],
    ['hatch run git push', 'push'],
    ['bundle exec gem push x.gem', 'publish'],
    ['conda run -n web git push', 'push'],
    [`npx bash -lc "${PUSH}"`, 'push'],
    ['yarn dlx vsce publish', 'publish'],
    ['bunx wrangler deploy', 'deploy'],
  ])('judges the command it runs: %s', (command, k) => {
    expect(under(command)).toEqual(every(k));
  });

  it.each(['uv run pytest -q', 'uv run scripts/gen.py', 'uv run uvicorn app:main --reload', 'poetry run python scripts/gen.py', 'bundle exec rspec', 'uv sync'])(
    'leaves routine work alone: %s',
    (command) => {
      expect(judge(command)).toEqual({ verdict: 'allow' });
    },
  );

  it('asks for a program the runner runs that the office does not know, unless the person is Trusted', () => {
    expect(under('poetry run frobnicate src')).toEqual({ default: 'other', check: 'other', trusted: 'allow' });
  });
});

describe("concurrently's commands, npm-run-all's scripts and nodemon's --exec", () => {
  it.each([
    ['concurrently "npm publish" "npm run dev"', 'publish'],
    ['concurrently "npm:dev" "npm:deploy:*"', 'deploy'],
    ['concurrently "npm:watch-*"', 'deploy'],
    [`concurrently --teardown "${PUSH}" "npm:dev"`, 'push'],
    ['npm-run-all build deploy:web', 'deploy'],
    ['run-p "watch-*"', 'deploy'],
    ['run-s build -- --watch', 'allow'],
    [`nodemon --exec "${PUSH}" src`, 'push'],
  ])('%s', (command, k) => {
    expect(under(command)).toEqual(every(k));
  });

  it('leaves commands that stay in the project alone', () => {
    expect(judge('concurrently -n web,css "npm:dev" "npm:watch-css"')).toEqual({ verdict: 'allow' });
    expect(judge('concurrently "vite" "tailwindcss -w"')).toEqual({ verdict: 'allow' });
  });
});

describe('a subshell in Bash', () => {
  it('ends its last word at the closing parenthesis, so `|| true)` runs true and not a program called "true)"', () => {
    // Asked the stakeholder as "Run true), a program the office doesn't know" in a real run.
    expect(judge("git status --short && (netstat -ano | grep -E ':(3000|3111) ' || true)")).toEqual({ verdict: 'allow' });
    expect(judge('(ls || true)')).toEqual({ verdict: 'allow' });
    expect(judge('(cd scripts && ls)')).toEqual({ verdict: 'allow' });
  });

  it('still judges every command inside it', () => {
    expect(under(`(ls || ${PUSH})`)).toEqual(every('push'));
    expect(under(`(${PUSH})`)).toEqual(every('push'));
    expect(under('(npm run build && npm publish)')).toEqual(every('publish'));
    expect(kind(judge('(ls; rm -rf ~/notes)'))).toBe('outside-project');
  });

  it('keeps a quoted parenthesis as text', () => {
    expect(judge('echo "done)" && grep -c "x)" scripts/check.sh')).toEqual({ verdict: 'allow' });
  });
});
