// v0.7's parity bench: the Claude Code both arms run, with the same profile applied to each (SPEC-v0.7.md, "Parity
// bench"). Point WORKLINGS_CLAUDE at this file for the Worklings arm and run it in place of `claude` for the plain arm, so
// the profile reaches both by construction.
//
//   BENCH_PROFILE=blank (default): v0.4's neutral method, never a moved CLAUDE_CONFIG_DIR. Only Claude Code's bundled
//     skills and built-in plugins: --setting-sources project,local, --strict-mcp-config with an empty MCP config,
//     ENABLE_CLAUDEAI_MCP_SERVERS=false, and claudeMdExcludes for the user's CLAUDE.md (project,local still loads it, probed
//     15 Nov 2026), merged into the --settings the caller passes.
//   BENCH_PROFILE=user: the person's own Claude Code setup, untouched (the own-setup check).
//
// A call that isn't a session (`--version`, `auth status`) passes through untouched. Credentials are never read: the
// sign-in stays Claude Code's own.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const args = process.argv.slice(2);
const profile = process.env.BENCH_PROFILE === 'user' ? 'user' : 'blank';
const session = args.includes('-p') || args.includes('--print');
const env = { ...process.env };
let made = null;

if (session && profile === 'blank') {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const exclude = join(configDir, 'CLAUDE.md').split(sep).join('/');
  const at = args.indexOf('--settings');
  let settings = {};
  if (at >= 0) {
    const value = args[at + 1] ?? '';
    const text = existsSync(value) ? readFileSync(value, 'utf8') : value;
    settings = JSON.parse(text);
    args.splice(at, 2);
  }
  settings.claudeMdExcludes = [...new Set([...(settings.claudeMdExcludes ?? []), exclude])];
  const dir = mkdtempSync(join(tmpdir(), 'bench-profile-'));
  made = dir;
  const file = join(dir, 'settings.json');
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  args.push('--settings', file, '--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}');
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
}

// BENCH_PROFILE_LOG names a file that records each session's launch, so a run shows what both arms started with.
if (session && process.env.BENCH_PROFILE_LOG) {
  const at = args.indexOf('--settings');
  const settings = at >= 0 && existsSync(args[at + 1] ?? '') ? JSON.parse(readFileSync(args[at + 1], 'utf8')) : null;
  appendFileSync(process.env.BENCH_PROFILE_LOG, `${JSON.stringify({ at: new Date().toISOString(), profile, args, settingsKeys: settings ? Object.keys(settings) : null, hooks: settings?.hooks ? Object.keys(settings.hooks) : null, claudeMdExcludes: settings?.claudeMdExcludes?.length ?? 0 })}
`);
}

// BENCH_REAL_CLAUDE names another executable (a dry run's fake desk, which runs under this Node).
const real = process.env.BENCH_REAL_CLAUDE || 'claude';
const [command, lead] = /\.m?js$/i.test(real) ? [process.execPath, [real]] : [real, []];
const child = spawn(command, [...lead, ...args], { env, stdio: 'inherit', windowsHide: true });
child.on('error', (error) => {
  process.stderr.write(`profile-claude: couldn't start Claude Code: ${error.message}\n`);
  process.exit(127);
});
child.on('exit', (code, signal) => {
  if (made) rmSync(made, { recursive: true, force: true });
  process.exit(code ?? (signal ? 1 : 0));
});
