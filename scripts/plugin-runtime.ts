// The Claude Code plugin's runtime: plugin/runtime holds the bundled CLI, the built web app and the library, so the
// plugin needs nothing but Node, and the release commits that folder so `claude plugin install` needs no build (why
// committed rather than fetched: docs/claude-code-surfaces.md, "Plugins"). Shared by scripts/build-plugin.mjs (npm run
// build:plugin), scripts/release-plugin.ts, scripts/check-plugin.mjs and the tests.
//
// A build goes to dist/plugin-runtime and replaces plugin/runtime only once it is complete, so the folder is never half
// written. runtime/runtime.json lists every file with its size and SHA-256, the version and the commit it was built
// from: a folder that doesn't match it is incomplete or changed by hand.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(import.meta.dirname, '..');
export const PLUGIN = 'worklings';
/** Where Worklings lives (scripts/home.json): the marketplace people add is this GitHub repository. */
export const REPOSITORY: string = (JSON.parse(readFileSync(join(import.meta.dirname, 'home.json'), 'utf8')) as { repository: string }).repository;
export const INSTALL_COMMANDS = [`claude plugin marketplace add ${REPOSITORY}`, `claude plugin install ${PLUGIN}@${PLUGIN}`];
export const RUNTIME_MANIFEST = 'runtime.json';
/** What the bundled CLI reads next to itself (src/paths.ts), and what the plugin's launcher starts. */
export const REQUIRED_FILES = ['cli.mjs', 'package.json', 'web/index.html', 'library/README.md'];
/** What the licences of the bundled code and fonts require every build to carry (scripts/third-party-notices.ts). */
export const NOTICE_FILES = ['THIRD-PARTY-NOTICES.md', 'web/THIRD-PARTY-NOTICES.md'];
/** The runtime's inputs: a change here that isn't committed means the runtime matches no commit. */
export const RUNTIME_SOURCES = ['src', 'web', 'library', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.plugin.config.ts', 'scripts/third-party-notices.ts'];

export interface RuntimeFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SourceState {
  commit: string;
  dirty: boolean;
}

export interface RuntimeManifest {
  name: string;
  version: string;
  source: SourceState | null;
  bytes: number;
  files: RuntimeFile[];
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every file under dir as a forward-slash path, sorted, without the manifest itself. */
export function runtimeFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return files.filter((f) => f !== RUNTIME_MANIFEST).sort();
}

/** The manifest of a built runtime folder. */
export function runtimeManifest(dir: string, meta: { name: string; version: string; source: SourceState | null }): RuntimeManifest {
  const files = runtimeFiles(dir).map((path) => {
    const file = join(dir, ...path.split('/'));
    return { path, bytes: statSync(file).size, sha256: sha256(file) };
  });
  return { ...meta, bytes: files.reduce((sum, f) => sum + f.bytes, 0), files };
}

const isRuntimeFile = (f: unknown): f is RuntimeFile =>
  isRecord(f) && typeof f.path === 'string' && Number.isInteger(f.bytes) && typeof f.sha256 === 'string';

/** A runtime manifest from its text, or a sentence saying why it can't be trusted. */
export function parseRuntimeManifest(text: string): RuntimeManifest | string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return `${RUNTIME_MANIFEST} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!isRecord(manifest) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || !Array.isArray(manifest.files) || !manifest.files.every(isRuntimeFile)) {
    return `${RUNTIME_MANIFEST} doesn't have the shape the build writes (a name, a version and a list of files).`;
  }
  const source = isRecord(manifest.source) && typeof manifest.source.commit === 'string' && typeof manifest.source.dirty === 'boolean'
    ? { commit: manifest.source.commit, dirty: manifest.source.dirty }
    : null;
  return { name: manifest.name, version: manifest.version, source, bytes: Number(manifest.bytes) || 0, files: manifest.files };
}

/** A runtime folder's manifest, or a sentence saying why there is none to trust. */
export function readRuntimeManifest(dir: string): RuntimeManifest | string {
  const file = join(dir, RUNTIME_MANIFEST);
  if (!existsSync(file)) return `${RUNTIME_MANIFEST} is missing, so the runtime was never fully built: rebuild it.`;
  return parseRuntimeManifest(readFileSync(file, 'utf8'));
}

/** What is wrong with a runtime folder, as sentences: nothing when every listed file is there, unchanged, and alone. */
export function checkRuntime(dir: string): string[] {
  if (!existsSync(dir)) return ['There is no runtime folder: build it with npm run build:plugin.'];
  const manifest = readRuntimeManifest(dir);
  if (typeof manifest === 'string') return [manifest];
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const { path, bytes, sha256: expected } of manifest.files) {
    if (isAbsolute(path) || path.split('/').some((part) => part === '..' || part === '' || part === '.')) {
      problems.push(`${RUNTIME_MANIFEST} lists a path outside the runtime: ${path}`);
      continue;
    }
    listed.add(path);
    const file = join(dir, ...path.split('/'));
    if (!existsSync(file)) problems.push(`${path} is missing.`);
    else if (statSync(file).size !== bytes || sha256(file) !== expected) problems.push(`${path} differs from the build.`);
  }
  for (const path of runtimeFiles(dir)) if (!listed.has(path)) problems.push(`${path} isn't part of the build.`);
  for (const path of REQUIRED_FILES) if (!listed.has(path)) problems.push(`The build has no ${path}, which the CLI needs.`);
  return problems;
}

/** The commit the sources are at, and whether they have changes not in it; null outside a git checkout. */
export function sourceState(root = ROOT): SourceState | null {
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', ...RUNTIME_SOURCES]) !== '' };
  } catch {
    return null;
  }
}

/** Moves a finished build into place: a rename when it can, a copy when it can't (another drive, a file held open). */
function swapIn(staging: string, out: string) {
  rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(join(out, '..'), { recursive: true });
  try {
    renameSync(staging, out);
  } catch {
    cpSync(staging, out, { recursive: true });
    rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

export interface BuildOptions {
  root?: string;
  out?: string;
  /** 'dist' copies dist/web (run `npm run build:web` first); 'build' builds the web app straight into the runtime. */
  web?: 'dist' | 'build';
  log?: (line: string) => void;
}

/** Builds the runtime into `out` (plugin/runtime), keeps plugin.json's version in step, and returns the manifest. */
export function buildRuntime({ root = ROOT, out = join(root, 'plugin', 'runtime'), web = 'dist', log = (line) => console.log(line) }: BuildOptions = {}): RuntimeManifest {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const dist = join(root, 'dist', 'web');
  if (web === 'dist' && !existsSync(join(dist, 'index.html'))) throw new Error('Build the web app first: npm run build:web');
  const staging = join(root, 'dist', 'plugin-runtime');
  rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const run = (what: string, args: string[]) => {
    log(what);
    try {
      execFileSync(process.execPath, [vite, ...args], { cwd: root, stdio: 'inherit' });
    } catch (error) {
      // Vite has printed why; plugin/runtime is untouched, since only a finished build replaces it.
      rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      throw new Error(`${what} failed (Vite's error is above), so plugin/runtime was left as it was.`, { cause: error });
    }
  };

  run('Bundling the CLI', ['build', '--config', 'vite.plugin.config.ts', '--outDir', staging, '--emptyOutDir']);
  if (web === 'build') {
    run('Building the web app', ['build', '--outDir', join(staging, 'web'), '--emptyOutDir']);
  } else {
    cpSync(dist, join(staging, 'web'), { recursive: true });
  }
  cpSync(join(root, 'library'), join(staging, 'library'), { recursive: true });
  for (const file of NOTICE_FILES) {
    if (!existsSync(join(staging, ...file.split('/')))) {
      rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      throw new Error(`The build has no ${file}, the third-party notices the bundled code's licences require, so plugin/runtime was left as it was.`);
    }
  }

  const pkg = readJson(join(root, 'package.json'));
  if (!isRecord(pkg) || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') throw new Error('package.json needs a name and a version.');
  writeFileSync(join(staging, 'package.json'), `${JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', private: true }, null, 2)}\n`);
  const manifest = runtimeManifest(staging, { name: pkg.name, version: pkg.version, source: sourceState(root) });
  writeFileSync(join(staging, RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  swapIn(staging, out);

  // The plugin's version is what makes installed copies update, so it follows the package's.
  const pluginJson = join(root, 'plugin', '.claude-plugin', 'plugin.json');
  const plugin = readJson(pluginJson);
  if (isRecord(plugin) && plugin.version !== pkg.version) writeFileSync(pluginJson, `${JSON.stringify({ ...plugin, version: pkg.version }, null, 2)}\n`);
  return manifest;
}

/**
 * What is wrong with the marketplace and the plugin manifest, as sentences: the rules an install from GitHub depends
 * on. `versions: false` leaves out the version rule, which a build fixes by itself.
 */
export function checkManifests(root = ROOT, { versions = true }: { versions?: boolean } = {}): string[] {
  const problems: string[] = [];
  const pkg = readJson(join(root, 'package.json'));
  const market = readJson(join(root, '.claude-plugin', 'marketplace.json'));
  const plugin = readJson(join(root, 'plugin', '.claude-plugin', 'plugin.json'));
  if (!isRecord(pkg) || !isRecord(market) || !isRecord(plugin)) return ['package.json, the marketplace and plugin.json must each be a JSON object.'];
  if (market.name !== PLUGIN) problems.push(`The marketplace is named "${String(market.name)}", but the install command says @${PLUGIN}.`);
  if (!isRecord(market.owner) || typeof market.owner.name !== 'string' || market.owner.name.trim() === '') problems.push('The marketplace needs owner.name.');
  const entries = Array.isArray(market.plugins) ? market.plugins : [];
  const entry: unknown = entries[0];
  if (entries.length !== 1 || !isRecord(entry) || entry.name !== PLUGIN) {
    problems.push(`The marketplace should list one plugin, "${PLUGIN}".`);
  } else {
    // A relative path resolves inside the clone Claude Code makes of the repository, so the runtime travels with it.
    if (entry.source !== './plugin') problems.push('The plugin entry\'s source should be "./plugin", the folder in this repository.');
    if ('version' in entry) problems.push("The plugin entry sets a version: plugin.json's wins and the two drift, so leave it out.");
  }
  if (plugin.name !== PLUGIN) problems.push(`plugin.json is named "${String(plugin.name)}", so its commands would not be /${PLUGIN}:…`);
  if (versions && plugin.version !== pkg.version) {
    problems.push(`plugin.json is at ${String(plugin.version)} but package.json at ${String(pkg.version)}: npm run build:plugin or scripts/release-plugin.ts puts them in step.`);
  }
  if (plugin.repository !== `https://github.com/${REPOSITORY}`) problems.push(`plugin.json's repository should be https://github.com/${REPOSITORY}.`);
  return problems;
}

/** Whether a script was run directly (node scripts/x) rather than imported; Windows paths compare without case. */
export function isMain(url: string): boolean {
  if (!process.argv[1]) return false;
  const [self, run] = [fileURLToPath(url), resolve(process.argv[1])];
  return process.platform === 'win32' ? self.toLowerCase() === run.toLowerCase() : self === run;
}
