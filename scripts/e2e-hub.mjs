// The hub for v3's end-to-end specs (test/e2e/v3-*.spec.ts): the real hub with every real part, serving the built web
// app, and only Claude Code faked (test/fake-desk.mjs, scripted by FAKE_DESK_SCRIPT). Its home and companies live in
// the e2e scratch folder, never in ~/.worklings. Configuration comes from the environment playwright.config.ts sets.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadLibrary } from '../src/composer/library.ts';
import { startHub } from '../src/hub/index.ts';

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
};
const scratch = need('E2E_HUB_SCRATCH');
const gitconfig = join(scratch, 'gitconfig');
mkdirSync(scratch, { recursive: true });
writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
// The company's own git reads this process's environment: give it this config and none of the machine's.
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const claudeHome = join(scratch, 'claude-home');
mkdirSync(join(claudeHome, 'projects'), { recursive: true });
mkdirSync(join(scratch, 'desk-scratch'), { recursive: true });
mkdirSync(join(scratch, 'aside'), { recursive: true });
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome };
delete env.CLAUDECODE;

const hub = await startHub({
  port: Number(need('E2E_HUB_PORT')),
  token: need('E2E_TOKEN'),
  webDir: resolve('dist', 'web'),
  library: loadLibrary(),
  home: need('E2E_HUB_HOME'),
  claude: need('WORKLINGS_CLAUDE'),
  env,
  claudeHome,
  tickMs: 50,
  desks: { scratch: join(scratch, 'desk-scratch') },
  aside: { env: { ...env }, workRoot: join(scratch, 'aside') },
  // v0.7: E2E_HUB_SHAPE=plain leaves the shape to each company's creator, as the CLI's hub does (the start form's choice,
  // plain by default); left out, every company is classic, which the specs drive by their CEO.
  ...(process.env.E2E_HUB_SHAPE === 'plain' ? {} : { shape: 'classic' }),
});
console.log(`e2e hub on ${hub.url}`);
const stop = () => void hub.close().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
