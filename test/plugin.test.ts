import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  checkManifests,
  checkRuntime,
  INSTALL_COMMANDS,
  parseRuntimeManifest,
  PLUGIN,
  REPOSITORY,
  REQUIRED_FILES,
  RUNTIME_MANIFEST,
  runtimeManifest,
} from '../scripts/plugin-runtime.ts';
import { tempDir, writeTree } from './library-kit.ts';

const root = join(import.meta.dirname, '..');
const plugin = join(root, 'plugin');
const runtime = join(plugin, 'runtime');
const BIN = 'worklings';
const SKILLS = ['adopt', 'fire', 'hire', 'hub', 'new', 'office'];

/** Every file the plugin ships except `runtime/`: build output, committed only at a release. */
function shipped(dir = plugin): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return path === runtime ? [] : shipped(path);
    return [path];
  });
}

const rel = (f: string) => relative(plugin, f).split(sep).join('/');
const skills = shipped().filter((f) => f.endsWith('SKILL.md'));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A skill's frontmatter and body. */
function readSkill(file: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(readFileSync(file, 'utf8'));
  const meta: unknown = match ? parse(match[1] ?? '') : null;
  if (!match || !isRecord(meta)) throw new Error(`${rel(file)} has no YAML frontmatter`);
  return { meta, body: match[2] ?? '' };
}

/** The commands a CLI's own help lists (the source's, or the built runtime's), so a skill can't call one it lacks. */
function cliCommands(entry = join(root, 'src', 'cli.ts')): Set<string> {
  const help = execFileSync(process.execPath, [entry, '--help'], { encoding: 'utf8' });
  return new Set([...help.matchAll(/^ {2}worklings \[?([a-z][a-z-]*)/gm)].map((m) => m[1] ?? ''));
}

/** Every `worklings <command>` a skill tells Claude to run, with the skill it is in. */
const skillCommands = () => skills.flatMap((file) => [...readSkill(file).body.matchAll(/`worklings ([a-z][a-z-]*)/g)].map((m) => ({ skill: rel(file), command: m[1] ?? '' })));

describe('the plugin', () => {
  it('ships the CLI shims for sh and cmd under the product name', () => {
    expect(readdirSync(join(plugin, 'bin')).sort()).toEqual([BIN, `${BIN}.cmd`]);
  });

  it('is named after the product, and its marketplace is this repository', () => {
    expect(PLUGIN).toBe(BIN);
    expect(checkManifests(root)).toEqual([]);
    const manifest: unknown = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(isRecord(manifest) && manifest.homepage).toBe(`https://github.com/${REPOSITORY}`);
    expect(INSTALL_COMMANDS).toEqual(['claude plugin marketplace add zeusstudiodev/worklings', 'claude plugin install worklings@worklings']);
  });

  it('has a command for the hub and the five from before', () => {
    expect(skills.map((f) => rel(f)).sort()).toEqual(SKILLS.map((n) => `skills/${n}/SKILL.md`));
  });

  it.each(skills.map((f) => [rel(f), f]))('%s has a name and a description and may run only the bin the plugin ships', (_name, file) => {
    const { meta } = readSkill(file);
    expect(meta.name).toBe(rel(file).split('/')[1]);
    expect(typeof meta.description === 'string' && meta.description.length > 40).toBe(true);
    const tools = String(meta['allowed-tools']).split(',').map((t) => t.trim());
    expect(tools).toContain(`Bash(${BIN} *)`);
    for (const tool of tools.filter((t) => t.startsWith('Bash('))) expect(tool).toBe(`Bash(${BIN} *)`);
  });

  it('asks the CLI only for commands it has', () => {
    const commands = cliCommands();
    expect(commands.has('hub')).toBe(true);
    for (const { skill, command } of skillCommands()) expect(commands, `${skill}: worklings ${command}`).toContain(command);
  });

  it('says how to install it from GitHub in its README', () => {
    const readme = readFileSync(join(plugin, 'README.md'), 'utf8');
    for (const line of INSTALL_COMMANDS) expect(readme).toContain(line);
    expect(readme).toContain(`/${PLUGIN}:hub`);
  });

  it('says nothing about the old name in any shipped file', () => {
    for (const file of shipped()) expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/headcount/i);
  });

  it('keeps its root free of what the bundled CLI would read before its own files', () => {
    // src/paths.ts looks one folder above runtime/cli.mjs first, and Claude Code installs dependencies for a plugin
    // with a package.json at its root.
    for (const name of ['package.json', 'library', 'dist', 'package-lock.json']) expect(existsSync(join(plugin, name)), name).toBe(false);
  });

  it('starts the CLI through a shim that checks for Node first', () => {
    const sh = readFileSync(join(plugin, 'bin', BIN), 'utf8');
    expect(sh.startsWith('#!/usr/bin/env sh\n')).toBe(true);
    expect(sh).not.toContain('\r');
    expect(sh).toContain('command -v node');
    expect(sh).toContain('exec node "$(dirname "$0")/../scripts/worklings.mjs" "$@"');
    const cmd = readFileSync(join(plugin, 'bin', `${BIN}.cmd`), 'utf8');
    expect(cmd).toContain('where node');
    expect(cmd).toContain('node "%~dp0..\\scripts\\worklings.mjs" %*');
    for (const text of [sh, cmd]) expect(text).toContain('https://nodejs.org/');
  });
});

describe("the plugin's launcher", () => {
  /** A copy of the plugin's launcher with the runtime given, so it runs without the real build. */
  function pluginCopy(cli: string | null): string {
    const dir = tempDir('worklings-plugin-');
    cpSync(join(plugin, 'scripts'), join(dir, 'scripts'), { recursive: true });
    if (cli !== null) writeTree(dir, { 'runtime/cli.mjs': cli });
    return dir;
  }

  it('runs the runtime with the arguments it was given', () => {
    const dir = pluginCopy('process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'worklings.mjs'), 'hub', '--port', '4380', 'a b'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(['hub', '--port', '4380', 'a b']);
  });

  it('says how to get a runtime when the copy has none', () => {
    const r = spawnSync(process.execPath, [join(pluginCopy(null), 'scripts', 'worklings.mjs'), 'hub'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('has no runtime');
    expect(r.stderr).toContain('claude plugin install worklings@worklings');
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

describe("the runtime's manifest", () => {
  const files = { 'cli.mjs': 'console.log(1);\n', 'package.json': '{}\n', 'web/index.html': '<div id="root"></div>\n', 'library/README.md': '# Library\n', 'web/assets/a.js': 'x\n' };

  function built(): string {
    const dir = writeTree(tempDir('worklings-runtime-'), files);
    const manifest = runtimeManifest(dir, { name: PLUGIN, version: '1.2.3', source: { commit: 'abc', dirty: false } });
    writeFileSync(join(dir, RUNTIME_MANIFEST), JSON.stringify(manifest));
    return dir;
  }

  it('lists every file with its size and hash, and a complete folder passes', () => {
    const dir = built();
    const manifest = parseRuntimeManifest(readFileSync(join(dir, RUNTIME_MANIFEST), 'utf8'));
    if (typeof manifest === 'string') throw new Error(manifest);
    expect(manifest.files.map((f) => f.path)).toEqual(Object.keys(files).sort());
    expect(manifest.bytes).toBe(Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0));
    expect(checkRuntime(dir)).toEqual([]);
  });

  it('finds a missing, a changed and an extra file', () => {
    const dir = built();
    rmSync(join(dir, 'web', 'assets', 'a.js'));
    writeFileSync(join(dir, 'cli.mjs'), 'console.log(2);\n');
    writeTree(dir, { 'web/assets/b.js': 'y\n' });
    expect(checkRuntime(dir)).toEqual(['cli.mjs differs from the build.', 'web/assets/a.js is missing.', "web/assets/b.js isn't part of the build."]);
  });

  it('refuses a folder that was never fully built, or a manifest that points outside it', () => {
    const dir = writeTree(tempDir('worklings-runtime-'), files);
    expect(checkRuntime(dir)).toEqual([`${RUNTIME_MANIFEST} is missing, so the runtime was never fully built: rebuild it.`]);
    writeFileSync(join(dir, RUNTIME_MANIFEST), JSON.stringify({ name: PLUGIN, version: '1', files: [{ path: '../outside.txt', bytes: 1, sha256: 'x' }] }));
    expect(checkRuntime(dir)).toContain(`${RUNTIME_MANIFEST} lists a path outside the runtime: ../outside.txt`);
    expect(checkRuntime(join(dir, 'nothing-here'))[0]).toMatch(/no runtime folder/);
  });

  it('needs the files the CLI reads next to itself', () => {
    const dir = writeTree(tempDir('worklings-runtime-'), { 'cli.mjs': 'x\n' });
    writeFileSync(join(dir, RUNTIME_MANIFEST), JSON.stringify(runtimeManifest(dir, { name: PLUGIN, version: '1', source: null })));
    expect(checkRuntime(dir)).toEqual(REQUIRED_FILES.filter((f) => f !== 'cli.mjs').map((f) => `The build has no ${f}, which the CLI needs.`));
  });

  it.runIf(existsSync(runtime))('matches the built plugin/runtime, at the plugin version', () => {
    expect(checkRuntime(runtime)).toEqual([]);
    const manifest = parseRuntimeManifest(readFileSync(join(runtime, RUNTIME_MANIFEST), 'utf8'));
    const pluginJson: unknown = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(typeof manifest === 'string' ? manifest : manifest.version).toBe(isRecord(pluginJson) ? pluginJson.version : null);
  });

  it.runIf(existsSync(runtime))('has every command the skills call, so the skills and the runtime ship together', () => {
    const commands = cliCommands(join(plugin, 'scripts', 'worklings.mjs'));
    for (const { skill, command } of skillCommands()) expect(commands, `${skill}: worklings ${command}`).toContain(command);
  });
});

describe('the manifest rules', () => {
  /** The three manifests in a temp folder, with changes, for the rules checkManifests applies. */
  function manifests(change: (m: { market: Record<string, unknown>; plugin: Record<string, unknown> }) => void): string {
    const dir = tempDir('worklings-manifests-');
    mkdirSync(join(dir, '.claude-plugin'));
    mkdirSync(join(dir, 'plugin', '.claude-plugin'), { recursive: true });
    const market: unknown = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const pluginJson: unknown = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
    if (!isRecord(market) || !isRecord(pluginJson)) throw new Error('manifests are not objects');
    change({ market, plugin: pluginJson });
    cpSync(join(root, 'package.json'), join(dir, 'package.json'));
    writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify(market));
    writeFileSync(join(dir, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify(pluginJson));
    return dir;
  }

  it('wants the relative source, no version in the entry, and the version in step', () => {
    const dir = manifests(({ market, plugin: p }) => {
      market.plugins = [{ name: PLUGIN, source: { source: 'github', repo: REPOSITORY }, version: '9.9.9' }];
      p.version = '0.0.0-old';
    });
    expect(checkManifests(dir)).toEqual([
      'The plugin entry\'s source should be "./plugin", the folder in this repository.',
      "The plugin entry sets a version: plugin.json's wins and the two drift, so leave it out.",
      expect.stringMatching(/^plugin\.json is at 0\.0\.0-old but package\.json at /),
    ]);
    expect(checkManifests(dir, { versions: false })).toHaveLength(2);
  });

  it('wants the product name everywhere the install command uses it', () => {
    const dir = manifests(({ market, plugin: p }) => {
      market.name = 'worklings-marketplace';
      p.name = 'studio';
      p.repository = 'https://github.com/someone/else';
    });
    expect(checkManifests(dir)).toEqual([
      'The marketplace is named "worklings-marketplace", but the install command says @worklings.',
      'plugin.json is named "studio", so its commands would not be /worklings:…',
      `plugin.json's repository should be https://github.com/${REPOSITORY}.`,
    ]);
  });
});
