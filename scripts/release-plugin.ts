// The plugin's release step. It produces exactly what the release commit holds, so that
//   claude plugin marketplace add zeusstudiodev/worklings
//   claude plugin install worklings@worklings
// works with no clone, npm install or build: plugin/runtime/ (the bundled CLI, the web app built here rather than
// copied from dist/, and the library) and plugin/.claude-plugin/plugin.json at package.json's version, which is what
// makes installed copies update. Then it checks the result and says what to commit. It never commits, tags or pushes.
//
//   node scripts/release-plugin.ts [--allow-dirty] [--stage] [--no-check]
//
//   --allow-dirty  build although src/, web/, library/ or the build config have uncommitted changes; the runtime then
//                  matches no commit, which is fine for a rehearsal and wrong for a release
//   --stage        git add the result (with --force, because .gitignore lists plugin/runtime/ on working branches) and
//                  mark plugin/bin/worklings executable in the index, which macOS and Linux need
//   --no-check     skip scripts/check-plugin.mjs (validate, install into a throwaway Claude config, start the hub)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  buildRuntime,
  checkManifests,
  checkRuntime,
  INSTALL_COMMANDS,
  isMain,
  parseRuntimeManifest,
  PLUGIN,
  ROOT,
  RUNTIME_MANIFEST,
  RUNTIME_SOURCES,
  type RuntimeFile,
  type RuntimeManifest,
  sourceState,
} from './plugin-runtime.ts';

const OPTIONS = ['--allow-dirty', '--stage', '--no-check'];

class ReleaseError extends Error {}

const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The runtime manifest of the last commit, if it holds a runtime: a release that changes it must change the version. */
function committedManifest(): RuntimeManifest | null {
  let text: string;
  try {
    text = git(['show', `HEAD:plugin/runtime/${RUNTIME_MANIFEST}`]);
  } catch {
    return null; // No runtime committed yet: the first release.
  }
  const manifest = parseRuntimeManifest(text);
  if (typeof manifest === 'string') throw new ReleaseError(`The last commit's plugin/runtime/${RUNTIME_MANIFEST} can't be read: ${manifest}`);
  return manifest;
}

const sameFiles = (a: RuntimeFile[], b: RuntimeFile[]) => a.length === b.length && a.every((f, i) => f.path === b[i]?.path && f.sha256 === b[i]?.sha256);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function release(args: string[]): void {
  const unknown = args.filter((a) => !OPTIONS.includes(a));
  if (unknown.length > 0) throw new ReleaseError(`Unknown option ${unknown.join(', ')}. Options: ${OPTIONS.join(', ')}.`);

  const before = checkManifests(ROOT, { versions: false });
  if (before.length > 0) throw new ReleaseError(before.join('\n'));
  const source = sourceState();
  if (!source) throw new ReleaseError('Release from a git checkout of the repository: the runtime records the commit it was built from.');
  if (source.dirty && !args.includes('--allow-dirty')) {
    throw new ReleaseError(`${RUNTIME_SOURCES.join(', ')} have uncommitted changes, so the runtime would match no commit. Commit them first, or pass --allow-dirty for a rehearsal.`);
  }
  const previous = committedManifest();

  const manifest = buildRuntime({ web: 'build' });
  const runtime = join(ROOT, 'plugin', 'runtime');
  const problems = [...checkRuntime(runtime), ...checkManifests()];
  if (problems.length > 0) throw new ReleaseError(`The release isn't ready:\n${problems.join('\n')}`);
  if (previous && previous.version === manifest.version && !sameFiles(previous.files, manifest.files)) {
    throw new ReleaseError(
      `The plugin is still at ${manifest.version}, as in the last commit, but its runtime changed, and installed copies update only when the version does. Raise the version in package.json, then run this again.`,
    );
  }

  if (!args.includes('--no-check')) {
    const check = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-plugin.mjs')], { cwd: ROOT, stdio: 'inherit' });
    if (check.status !== 0) throw new ReleaseError('scripts/check-plugin.mjs failed: fix what it says before releasing, or pass --no-check to look at the build alone.');
  }

  const stage = args.includes('--stage');
  if (stage) {
    git(['add', '--force', '--all', '--', 'plugin', '.claude-plugin']);
    git(['update-index', '--chmod=+x', 'plugin/bin/worklings']);
  }
  const mode = git(['ls-files', '--stage', '--', 'plugin/bin/worklings']).split(/\s+/)[0] ?? '';
  const compressed = manifest.files.reduce((sum, f) => sum + gzipSync(readFileSync(join(runtime, ...f.path.split('/')))).length, 0);

  const out = (line = '') => process.stdout.write(`${line}\n`);
  out();
  out(`Worklings plugin ${manifest.version}, built from ${source.commit.slice(0, 12)}${source.dirty ? ' with uncommitted changes (a rehearsal)' : ''}.`);
  out(`  plugin/runtime: ${manifest.files.length} files, ${mb(manifest.bytes)} (${mb(compressed)} compressed)`);
  out();
  out(stage ? 'Staged for the release commit (nothing was committed):' : 'For the release commit (nothing here commits, tags or pushes):');
  out('  git add --force --all -- plugin .claude-plugin');
  out('  git update-index --chmod=+x plugin/bin/worklings');
  out(`  git commit -m "Release ${manifest.version}"`);
  if (mode !== '100755') out(`  plugin/bin/worklings is ${mode || 'not in the index'} now; macOS and Linux need 100755, which the second line sets.`);
  out();
  out('Once it is pushed, people install it with:');
  for (const line of INSTALL_COMMANDS) out(`  ${line}`);
  out(`and run /${PLUGIN}:hub in Claude Code. Installed copies update with \`claude plugin update ${PLUGIN}@${PLUGIN}\`.`);
}

if (isMain(import.meta.url)) {
  try {
    release(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
