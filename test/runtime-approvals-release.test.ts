// What deploys or publishes asks as that under every leash, whoever runs it: release tools the policy doesn't know by
// name (their name or a word they are given says it), the subcommands and task names of the tools it knows, and the
// project's own programs. Trusted lifts routine work in the project, never a release.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPermission, type PermissionVerdict } from '../src/runtime/approvals.ts';
import { tempDir } from './library-kit.ts';

let root = '';
let home = '';
let tmp = '';

beforeAll(() => {
  const dir = tempDir('worklings-release-');
  root = join(dir, 'cafe');
  home = join(dir, 'home');
  tmp = join(dir, 'tmp');
  for (const d of [join(root, 'node_modules', '.bin'), join(root, 'src'), home, tmp]) mkdirSync(d, { recursive: true });
  // vsce as the project installs it, so it runs as the project's own program.
  writeFileSync(join(root, 'node_modules', '.bin', 'vsce'), '');
  writeFileSync(join(root, 'src', 'app.ts'), 'export {};\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cafe', scripts: { build: 'vite build', 'deploy:web': 'wrangler deploy' }, devDependencies: { '@vscode/vsce': '3.0.0' } }));
});

const LEASHES = ['default', 'check', 'trusted'] as const;
const judge = (command: string, leash: (typeof LEASHES)[number] = 'default'): PermissionVerdict =>
  classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command }, cwd: root }, { root, branch: null, rules: [], home, tmp, leash });
const kind = (v: PermissionVerdict) => (v.verdict === 'ask' ? v.kind : v.verdict);
const under = (command: string) => Object.fromEntries(LEASHES.map((leash) => [leash, kind(judge(command, leash))]));
const every = (k: string) => ({ default: k, check: k, trusted: k });

describe('release tools the office does not know by name', () => {
  it.each([
    ['ovsx publish', 'publish'],
    ['goreleaser release --clean', 'publish'],
    ['fastlane deliver', 'publish'],
    ['ansible-playbook deploy.yml', 'deploy'],
    ['kamal deploy', 'deploy'],
    ['pdm publish', 'publish'],
    ['maturin publish', 'publish'],
    ['huggingface-cli upload user/model .', 'deploy'],
    ['semantic-release --no-ci', 'publish'],
  ])('%s asks as %s under every leash', (command, k) => {
    expect(under(command)).toEqual(every(k));
  });

  it('says what it runs, with an exact rule to allow it', () => {
    expect(judge('ovsx publish', 'trusted')).toMatchObject({ verdict: 'ask', kind: 'publish', summary: 'Publish with ovsx publish', alwaysRule: { rule: 'Bash(ovsx publish)' } });
    expect(judge('kamal deploy -d production', 'trusted')).toMatchObject({ kind: 'deploy', summary: 'Deploy with kamal deploy' });
  });

  it('still lets a Trusted person run an unknown program that says nothing of releasing', () => {
    expect(under('frobnicate build src/app.ts')).toEqual({ default: 'other', check: 'other', trusted: 'allow' });
  });
});

describe('subcommands and task names that release, in the tools the office knows', () => {
  it.each([
    ['dart pub publish', 'publish'],
    ['flutter pub publish --force', 'publish'],
    ['deno publish', 'publish'],
    ['deno deploy --prod', 'deploy'],
    ['mix hex.publish', 'publish'],
    ['pod trunk push App.podspec', 'publish'],
    ['wasm-pack publish --access public', 'publish'],
    ['vsce publish', 'publish'],
    ['npx vsce publish', 'publish'],
    ['pnpm dlx vsce publish', 'publish'],
    ['turbo run deploy', 'deploy'],
    ['turbo deploy --filter web', 'deploy'],
    ['nx run app:deploy', 'deploy'],
    ['nx run-many -t build,deploy', 'deploy'],
    ['nx affected --target=deploy', 'deploy'],
    ['node --run deploy:web', 'deploy'],
  ])('%s asks as %s under every leash', (command, k) => {
    expect(under(command)).toEqual(every(k));
  });

  it.each([
    'dart pub get',
    'flutter build apk --release',
    'swift build -c release',
    'cargo build --release',
    'mix test',
    'pod install',
    'vsce package',
    'npx vsce package',
    'turbo run build --filter web',
    'nx run app:build',
    'deno task dev',
    'node --run build',
  ])('leaves routine work alone: %s', (command) => {
    expect(judge(command)).toEqual({ verdict: 'allow' });
  });
});
