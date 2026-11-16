import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { origin, ports } from './test/e2e/addresses.ts';
import { DEV_APP_PORT, HUB_PORT, PLAIN_HUB_PORT, REST_HUB_PORT, writeScript } from './test/e2e/v3-world.ts';

// Four offices run for the suite: the built-in demo, a live office for a throwaway project with a generated studio
// (so hire/fire/move are tested against real files), an empty folder and a 50-person studio. They share a token we
// know, in a home folder of their own. Everything lives in one folder for the run, named with the time it started: a
// config that loads on this machine from another run (another person's, or one that dies on a busy port) used to empty
// the one fixed folder under a run in progress. Folders of earlier runs go once they are an hour old, and the last run's
// files stay there to look at when a test fails.
const RUN_PREFIX = 'worklings-e2e-';
if (!process.env.E2E_SCRATCH) {
  for (const old of readdirSync(tmpdir()).filter((n) => n === 'worklings-e2e' || n.startsWith(RUN_PREFIX))) {
    const path = join(tmpdir(), old);
    if (Date.now() - statSync(path).mtimeMs > 3_600_000) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
const scratch = process.env.E2E_SCRATCH ?? join(tmpdir(), `${RUN_PREFIX}${Date.now()}`);
process.env.E2E_SCRATCH = scratch;
const home = process.env.E2E_HOME ?? join(scratch, 'home');
const token = process.env.E2E_TOKEN ?? 'e2e-token-0123456789abcdefghijklmnopqrstuv';
const projectDir = process.env.E2E_PROJECT ?? join(scratch, 'project');
const emptyDir = process.env.E2E_EMPTY ?? join(scratch, 'empty');
const bigDir = process.env.E2E_BIG ?? join(scratch, 'big');
// The live project office gets a Claude Code of its own: the fake, a config folder whose projects/ folder is where
// the office reads transcripts, and a log of every headless run (Catch me up, Ask aside) the fake is asked for.
const claudeHome = process.env.E2E_CLAUDE_HOME ?? join(scratch, 'claude-home');
const fakeClaude = process.env.E2E_FAKE_CLAUDE ?? resolve('test', 'fake-claude.mjs');
const fakeClaudeLog = process.env.E2E_CLAUDE_LOG ?? join(scratch, 'fake-claude.log');
// v3's hub (scripts/e2e-hub.mjs): the real hub with every real part and only Claude Code faked, by test/fake-desk.mjs
// and a script; its home, companies and desk log live in a folder of their own in the run's.
const hubScratch = process.env.E2E_HUB_SCRATCH ?? join(scratch, 'hub');
const hubHome = join(hubScratch, 'home');
for (const dir of [home, projectDir, emptyDir, bigDir, hubHome, join(claudeHome, 'projects')]) mkdirSync(dir, { recursive: true });

// A studio the size of Claude Code Game Studios, with no studio.yaml, plus one absurdly long role name.
const BIG_ROSTER = [
  'accessibility-specialist', 'ai-programmer', 'analytics-engineer', 'art-director', 'audio-director', 'community-manager',
  'creative-director', 'devops-engineer', 'economy-designer', 'engine-programmer', 'game-designer', 'gameplay-programmer',
  'godot-csharp-specialist', 'godot-gdextension-specialist', 'godot-gdscript-specialist', 'godot-shader-specialist',
  'godot-specialist', 'lead-programmer', 'level-designer', 'live-ops-designer', 'localization-lead', 'narrative-director',
  'network-programmer', 'performance-analyst', 'producer', 'prototyper', 'qa-lead', 'qa-tester', 'release-manager',
  'security-engineer', 'sound-designer', 'systems-designer', 'technical-artist', 'technical-director', 'tools-programmer',
  'ue-blueprint-specialist', 'ue-gas-specialist', 'ue-replication-specialist', 'ue-umg-specialist', 'ui-programmer',
  'unity-addressables-specialist', 'unity-dots-specialist', 'unity-shader-specialist', 'unity-specialist',
  'unity-ui-specialist', 'unreal-specialist', 'ux-designer', 'world-builder', 'writer',
  'senior-principal-distinguished-gameplay-systems-and-tooling-programmer',
];

if (!process.env.E2E_PROJECT) {
  mkdirSync(join(home, '.worklings'), { recursive: true });
  writeFileSync(join(home, '.worklings', 'token'), `${token}\n`);
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'e2e-web-app', dependencies: { react: '^19.3.1', 'react-router': '^8.1.0' }, devDependencies: { typescript: '~6.0.3' } }));
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  execFileSync(process.execPath, ['dist/cli.js', 'new', projectDir, '--domain', 'web-app', '--rigor', 'standard', '--idea', 'A test web app'], { env: { ...process.env, WORKLINGS_HOME: home } });
  mkdirSync(join(bigDir, '.claude', 'agents'), { recursive: true });
  for (const id of BIG_ROSTER) writeFileSync(join(bigDir, '.claude', 'agents', `${id}.md`), `---\nname: ${id}\ndescription: The ${id.replaceAll('-', ' ')}.\n---\nBody\n`);
}
// Workers re-load this file: hand them the same folders and token instead of making new ones.
process.env.E2E_HOME = home;
process.env.E2E_TOKEN = token;
process.env.E2E_PROJECT = projectDir;
process.env.E2E_EMPTY = emptyDir;
process.env.E2E_BIG = bigDir;
process.env.E2E_CLAUDE_HOME = claudeHome;
process.env.E2E_FAKE_CLAUDE = fakeClaude;
process.env.E2E_CLAUDE_LOG = fakeClaudeLog;
process.env.E2E_HUB_SCRATCH = hubScratch;
process.env.E2E_DEV_APP = resolve('test', 'fixtures', 'e2e', 'dev-app.mjs');

// Every port of the suite is chosen once, free, when this file first loads (test/e2e/addresses.ts) and reaches the workers
// through the environment.
const port = ports();
process.env.E2E_PORTS = JSON.stringify(port);

const env = { ...process.env, WORKLINGS_HOME: home } as Record<string, string>;
const liveEnv = { ...env, WORKLINGS_CLAUDE: fakeClaude, CLAUDE_CONFIG_DIR: claudeHome, FAKE_CLAUDE_LOG: fakeClaudeLog };

const hubEnv: Record<string, string> = {
  ...env,
  E2E_HUB_PORT: String(HUB_PORT),
  E2E_HUB_HOME: hubHome,
  E2E_DEV_APP_PORT: String(DEV_APP_PORT),
  WORKLINGS_CLAUDE: resolve('test', 'fake-desk.mjs'),
  FAKE_DESK_SCRIPT: writeScript(hubScratch),
  FAKE_DESK_LOG: join(hubScratch, 'desk.jsonl'),
  FAKE_DESK_SESSIONS: join(hubScratch, 'sessions'),
};
delete hubEnv.CLAUDECODE;
// The rest spec's hub: a usage limit stops every company of a hub, so it gets one of its own.
const restScratch = `${hubScratch}-rest`;
const restEnv = {
  ...hubEnv,
  E2E_HUB_PORT: String(REST_HUB_PORT),
  E2E_HUB_SCRATCH: restScratch,
  E2E_HUB_HOME: join(restScratch, 'home'),
  FAKE_DESK_SCRIPT: writeScript(restScratch),
  FAKE_DESK_LOG: join(restScratch, 'desk.jsonl'),
  FAKE_DESK_SESSIONS: join(restScratch, 'sessions'),
};
mkdirSync(restEnv.E2E_HUB_HOME, { recursive: true });
// v0.7: the hub whose new companies are plain jobs (one Claude Code session), as the CLI founds them.
const plainScratch = `${hubScratch}-plain`;
const plainEnv = {
  ...hubEnv,
  E2E_HUB_PORT: String(PLAIN_HUB_PORT),
  E2E_HUB_SCRATCH: plainScratch,
  E2E_HUB_HOME: join(plainScratch, 'home'),
  E2E_HUB_SHAPE: 'plain',
  FAKE_DESK_SCRIPT: writeScript(plainScratch),
  FAKE_DESK_LOG: join(plainScratch, 'desk.jsonl'),
  FAKE_DESK_SESSIONS: join(plainScratch, 'sessions'),
};
mkdirSync(plainEnv.E2E_HUB_HOME, { recursive: true });

/** The specs that run at every size of the stage and dock, not only at 1440 and 375 (v0.2: the lobby and progress too). */
const STAGE_SPECS = /v3-(shell|boards|task-board|org|lobby|progress)\.spec\.ts/;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
  webServer: [
    { command: `node dist/cli.js demo --port ${port.demo} --no-open`, url: `${origin(port.demo)}/api/state`, env, reuseExistingServer: false },
    { command: `node dist/cli.js office "${projectDir}" --port ${port.live} --no-open`, url: `${origin(port.live)}/api/state`, env: liveEnv, reuseExistingServer: false },
    { command: `node dist/cli.js office "${emptyDir}" --port ${port.empty} --no-open`, url: `${origin(port.empty)}/api/state`, env, reuseExistingServer: false },
    { command: `node dist/cli.js office "${bigDir}" --port ${port.big} --no-open`, url: `${origin(port.big)}/api/state`, env, reuseExistingServer: false },
    { command: 'node scripts/e2e-hub.mjs', url: `${origin(HUB_PORT)}/api/lobby`, env: hubEnv, reuseExistingServer: false },
    { command: 'node scripts/e2e-hub.mjs', url: `${origin(REST_HUB_PORT)}/api/lobby`, env: restEnv, reuseExistingServer: false },
    { command: 'node scripts/e2e-hub.mjs', url: `${origin(PLAIN_HUB_PORT)}/api/lobby`, env: plainEnv, reuseExistingServer: false },
  ],
  projects: [
    { name: 'desktop', testIgnore: /v3-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', testIgnore: /v3-.*\.spec\.ts/, use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
    // v3 runs against its own hub (scripts/e2e-hub.mjs), a company per spec, so these two never touch the offices above.
    { name: 'v3', testMatch: /v3-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'v3-phone', testMatch: /v3-.*\.spec\.ts/, use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
    // The stage and dock's shell, boards and chart also at the sizes between (docs/design-v3.md, "The shell"): a laptop
    // window at 1024 x 768, where the side panel docks at 320 px; an iPad upright or half a laptop screen at 768 x 1024,
    // where it floats; and a phone on its side at 812 x 375, the phone layout's short form, its bar scrolling away.
    { name: 'v3-1024', testMatch: STAGE_SPECS, use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'v3-768', testMatch: STAGE_SPECS, use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'v3-phone-side', testMatch: STAGE_SPECS, use: { ...devices['Pixel 7'], viewport: { width: 812, height: 375 } } },
  ],
});
