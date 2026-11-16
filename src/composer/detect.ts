// Reads a project folder and works out its stack, its commands and which domain blueprints fit it.
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { Library } from './library.ts';

export interface DomainMatch {
  id: string;
  priority: number;
  score: number;
  reasons: string[];
}

export interface Commands {
  dev?: string;
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
  e2e?: string;
}

export interface Detection {
  root: string;
  name: string;
  /** Nothing to detect: a brand-new project, so the composer keeps the domain's default rules. */
  isEmpty: boolean;
  /** Stack ids from the vocabulary rules use in their `stacks` field. */
  stacks: string[];
  /** Human-readable stack with versions, for the "This project" section. */
  frameworks: string[];
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  commands: Commands;
  /** Top-level folders, which tell the agents where things are and which rule globs apply. */
  folders: string[];
  rootFiles: string[];
  domains: DomainMatch[];
}

type Json = Record<string, unknown>;

const IGNORED_FOLDERS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.expo', '.turbo', '.venv', 'venv', '__pycache__',
  '.idea', '.vscode', '.svelte-kit', '.astro', '.wrangler', 'target', 'obj', 'Library', 'Temp', 'Logs', '.cache',
  'test-results', 'playwright-report', '.godot', 'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache',
]);

/** npm package -> stack ids it implies. */
const NPM_STACKS: Record<string, string[]> = {
  typescript: ['typescript'],
  react: ['react'],
  'react-native': ['react-native'],
  expo: ['expo', 'react-native'],
  next: ['nextjs', 'react'],
  'react-router': ['react-router'],
  '@react-router/dev': ['react-router'],
  'react-router-dom': ['react-router'],
  '@remix-run/react': ['remix', 'react'],
  astro: ['astro'],
  vue: ['vue'],
  nuxt: ['vue'],
  svelte: ['svelte'],
  '@sveltejs/kit': ['svelte'],
  vite: ['vite'],
  tailwindcss: ['tailwind'],
  wrangler: ['cloudflare-workers'],
  '@cloudflare/workers-types': ['cloudflare-workers'],
  hono: ['hono', 'node'],
  express: ['express', 'node'],
  fastify: ['fastify', 'node'],
  koa: ['node'],
  '@nestjs/core': ['node'],
  '@anthropic-ai/sdk': ['llm'],
  '@anthropic-ai/claude-agent-sdk': ['llm'],
  openai: ['llm'],
  langchain: ['llm'],
  '@langchain/core': ['llm'],
  ai: ['llm'],
  llamaindex: ['llm'],
  phaser: ['phaser'],
  three: ['threejs'],
  '@react-three/fiber': ['threejs', 'react'],
  'pixi.js': ['pixi'],
  kaplay: ['kaplay'],
  kaboom: ['kaplay'],
  electron: ['electron'],
  '@tauri-apps/api': ['tauri'],
  '@tauri-apps/cli': ['tauri'],
  wxt: ['chrome-extension'],
  plasmo: ['chrome-extension'],
  '@types/chrome': ['chrome-extension'],
  playwright: ['playwright'],
  '@playwright/test': ['playwright', 'tests'],
  puppeteer: ['puppeteer'],
  crawlee: ['crawlee'],
  apify: ['apify'],
  prisma: ['sql', 'prisma'],
  '@prisma/client': ['sql', 'prisma'],
  'drizzle-orm': ['sql', 'drizzle'],
  typeorm: ['sql'],
  sequelize: ['sql'],
  knex: ['sql'],
  kysely: ['sql'],
  pg: ['sql'],
  mysql2: ['sql'],
  'better-sqlite3': ['sql'],
  vitest: ['tests'],
  jest: ['tests'],
  mocha: ['tests'],
  ava: ['tests'],
  docusaurus: ['docs-site'],
  '@docusaurus/core': ['docs-site'],
  vitepress: ['docs-site'],
  '@astrojs/starlight': ['docs-site'],
};

/** Python package -> stack ids. */
const PY_STACKS: Record<string, string[]> = {
  fastapi: ['fastapi'],
  django: ['django', 'sql'],
  flask: ['flask'],
  torch: ['pytorch'],
  tensorflow: ['tensorflow'],
  'scikit-learn': ['sklearn'],
  sklearn: ['sklearn'],
  pandas: ['pandas'],
  jupyter: ['jupyter'],
  notebook: ['jupyter'],
  anthropic: ['llm'],
  openai: ['llm'],
  langchain: ['llm'],
  'llama-index': ['llm'],
  playwright: ['playwright'],
  scrapy: ['scrapy'],
  crawlee: ['crawlee'],
  apify: ['apify'],
  sqlalchemy: ['sql'],
  alembic: ['sql'],
  pytest: ['tests'],
};

/** Display names for the frameworks worth naming in the "This project" section. */
const LABELS: Record<string, string> = {
  expo: 'Expo', 'react-native': 'React Native', react: 'React', next: 'Next.js', 'react-router': 'React Router',
  '@react-router/dev': 'React Router', astro: 'Astro', vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit',
  vite: 'Vite', tailwindcss: 'Tailwind CSS', wrangler: 'Cloudflare Workers', hono: 'Hono', express: 'Express',
  fastify: 'Fastify', phaser: 'Phaser', three: 'Three.js', 'pixi.js': 'PixiJS', kaplay: 'Kaplay', electron: 'Electron',
  '@tauri-apps/api': 'Tauri', '@anthropic-ai/sdk': 'Anthropic SDK', openai: 'OpenAI SDK', ai: 'Vercel AI SDK',
  prisma: 'Prisma', 'drizzle-orm': 'Drizzle', '@playwright/test': 'Playwright', playwright: 'Playwright',
  crawlee: 'Crawlee', apify: 'Apify SDK', vitest: 'Vitest', jest: 'Jest', typescript: 'TypeScript',
};

function readJson(path: string): Json | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const record = (v: unknown): Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

const version = (range: string) => range.replace(/^[\^~>=<\s]+/, '').replace(/^npm:.*@/, '');

type Table = Record<string, unknown>;
const table = (v: unknown): Table => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Table) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A TOML file (pyproject.toml, Pipfile) as tables; one that doesn't parse counts as empty, like a missing file. */
function readToml(path: string): Table {
  const text = readText(path);
  if (!text) return {};
  try {
    return parseToml(text) as Table;
  } catch {
    return {};
  }
}

/** A package name as Python compares them (PEP 503): "Scikit_Learn" -> "scikit-learn". */
const normalise = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** The package a requirement names: "uvicorn[standard]>=0.30; python_version > '3.9'" -> "uvicorn". */
const requirementName = (requirement: string): string | undefined => {
  const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement)?.[1];
  return name ? normalise(name) : undefined;
};

/** The quoted strings in setup.py's `key=[...]` lists, read string by string so "pkg[extra]" doesn't end the list. */
function setupList(text: string, key: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${key}\\s*=\\s*\\[`, 'g'))) {
    let i = (m.index ?? 0) + m[0].length;
    while (i < text.length && text[i] !== ']') {
      const c = text[i];
      if (c === '"' || c === "'") {
        const end = text.indexOf(c, i + 1);
        if (end === -1) break;
        out.push(text.slice(i + 1, end));
        i = end + 1;
      } else if (c === '#') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end;
      } else {
        i += 1;
      }
    }
  }
  return out;
}

/**
 * The project's Python dependencies, from the places that declare them: pyproject.toml (PEP 621, dependency groups,
 * Poetry, uv), Pipfile, requirements*.txt and setup.py. Prose in those files (a description, a comment) doesn't count.
 */
function pythonPackages(root: string, rootFiles: string[], pyproject: Table): Set<string> {
  const names = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) names.add(name);
  };
  const project = table(pyproject.project);
  const tool = table(pyproject.tool);
  const poetry = table(tool.poetry);
  for (const req of [
    ...strings(project.dependencies),
    ...Object.values(table(project['optional-dependencies'])).flatMap(strings),
    ...Object.values(table(pyproject['dependency-groups'])).flatMap(strings),
    ...strings(table(tool.uv)['dev-dependencies']),
  ]) {
    add(requirementName(req));
  }
  const poetryTables = [poetry.dependencies, poetry['dev-dependencies'], ...Object.values(table(poetry.group)).map((g) => table(g).dependencies)];
  for (const t of poetryTables) for (const name of Object.keys(table(t))) if (name !== 'python') add(normalise(name));
  if (rootFiles.includes('Pipfile')) {
    const pipfile = readToml(join(root, 'Pipfile'));
    for (const name of [...Object.keys(table(pipfile.packages)), ...Object.keys(table(pipfile['dev-packages']))]) add(normalise(name));
  }
  for (const file of rootFiles.filter((f) => /^requirements.*\.txt$/.test(f))) {
    for (const line of readText(join(root, file)).split(/\r?\n/)) {
      const req = line.replace(/(^|\s)#.*$/, '').trim();
      if (req && !req.startsWith('-')) add(requirementName(req));
    }
  }
  if (rootFiles.includes('setup.py')) {
    const text = readText(join(root, 'setup.py'));
    for (const req of ['install_requires', 'tests_require', 'setup_requires'].flatMap((key) => setupList(text, key))) add(requirementName(req));
  }
  return names;
}

/** A lookup in one of the tables below that ignores Object.prototype ("constructor" is a word, not a package). */
const own = <T>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

export function detect(root: string, library?: Library): Detection {
  const entries = existsSync(root) ? readdirSync(root) : [];
  const folders = entries
    .filter((f) => !f.startsWith('.') || f === '.actor' || f === '.claude')
    .filter((f) => !IGNORED_FOLDERS.has(f) && statSync(join(root, f)).isDirectory())
    .sort();
  const rootFiles = entries.filter((f) => !statSync(join(root, f)).isDirectory()).sort();
  const has = (name: string) => entries.includes(name);
  const stacks = new Set<string>();
  const frameworks: string[] = [];

  const pkg = has('package.json') ? readJson(join(root, 'package.json')) : null;
  const deps = { ...record(pkg?.devDependencies), ...record(pkg?.dependencies) };
  if (pkg) {
    stacks.add('javascript');
    stacks.add('node');
  }
  // Runtime dependencies first, so the frameworks list leads with what the app is built on.
  for (const [name, range] of [...Object.entries(record(pkg?.dependencies)), ...Object.entries(record(pkg?.devDependencies))]) {
    for (const s of own(NPM_STACKS, name) ?? []) stacks.add(s);
    if (name.startsWith('@shopify/')) stacks.add('shopify');
    if (name.startsWith('@ai-sdk/') || name.startsWith('@langchain/')) stacks.add('llm');
    const label = name === 'typescript' ? undefined : own(LABELS, name);
    if (label && !frameworks.some((f) => f.startsWith(`${label} `) || f === label)) frameworks.push(`${label} ${version(range)}`.trim());
  }
  if (has('tsconfig.json')) stacks.add('typescript');
  if (pkg?.bin) stacks.add('cli');
  const appFramework = ['react-dom', 'next', 'expo', 'astro', 'vite', 'electron', 'phaser', '@sveltejs/kit', 'nuxt'].some((d) => d in deps);
  if (pkg && (pkg.exports || pkg.main || pkg.types) && !appFramework && pkg.private !== true) stacks.add('library');

  const pyproject = rootFiles.includes('pyproject.toml') ? readToml(join(root, 'pyproject.toml')) : {};
  const py = pythonPackages(root, rootFiles, pyproject);
  if (py.size > 0 || rootFiles.some((f) => f.endsWith('.py'))) stacks.add('python');
  for (const name of py) for (const s of own(PY_STACKS, name) ?? []) stacks.add(s);
  if (py.has('pytest') || (stacks.has('python') && (folders.includes('tests') || folders.includes('test')))) stacks.add('tests');

  const anyFile = (re: RegExp) => rootFiles.some((f) => re.test(f));
  if (anyFile(/^wrangler\.(toml|jsonc?)$/)) stacks.add('cloudflare-workers');
  if (anyFile(/^astro\.config\./)) stacks.add('astro');
  if (anyFile(/^next\.config\./)) stacks.add('nextjs');
  if (anyFile(/\.ipynb$/) || folders.includes('notebooks')) stacks.add('jupyter');
  if (has('project.godot')) {
    stacks.add('godot');
    frameworks.push('Godot');
  }
  if (folders.includes('Assets') && folders.includes('ProjectSettings')) {
    stacks.add('unity');
    const projectVersion = readText(join(root, 'ProjectSettings', 'ProjectVersion.txt')).match(/m_EditorVersion:\s*(\S+)/)?.[1];
    frameworks.push(projectVersion ? `Unity ${projectVersion}` : 'Unity');
  }
  if (anyFile(/\.uproject$/)) {
    stacks.add('unreal');
    frameworks.push('Unreal Engine');
  }
  if (folders.includes('src-tauri')) stacks.add('tauri');
  if (folders.includes('.actor') || has('apify.json')) stacks.add('apify');
  if (has('Cargo.toml') && !folders.includes('src-tauri')) stacks.add('rust');
  if (has('go.mod')) stacks.add('go');
  if (has('mkdocs.yml')) stacks.add('docs-site');
  if (folders.includes('migrations') || folders.includes('prisma')) stacks.add('sql');
  if (folders.some((f) => f === 'tests' || f === 'test' || f === '__tests__' || f === 'e2e')) stacks.add('tests');
  const manifest = has('manifest.json') ? readJson(join(root, 'manifest.json')) : null;
  if (manifest && 'manifest_version' in manifest) stacks.add('chrome-extension');
  if (stacks.has('typescript')) frameworks.push(deps.typescript ? `TypeScript ${version(deps.typescript)}` : 'TypeScript');
  if (stacks.has('python')) frameworks.push('Python');

  const packageManager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : pkg ? 'npm' : null;
  const commands = projectCommands(record(pkg?.scripts), packageManager, py, stacks);

  const pyName = table(pyproject.project).name ?? table(table(pyproject.tool).poetry).name;
  const name = (typeof pkg?.name === 'string' && pkg.name) || (typeof pyName === 'string' && pyName) || basename(root);
  const meaningful = [...stacks].filter((s) => s !== 'javascript' && s !== 'node');
  const isEmpty = meaningful.length === 0 && Object.keys(deps).length === 0 && !rootFiles.some(isCode) && !hasCodeBelow(root, folders);

  return {
    root, name, isEmpty, stacks: [...stacks].sort(), frameworks, packageManager, commands, folders, rootFiles,
    domains: library ? scoreDomains(library, { deps, rootFiles, folders, py, root }) : [],
  };
}

const isCode = (file: string) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|gd|cs|swift|kt|java|rb|php|c|cc|cpp|h|lua|svelte|vue)$/.test(file);

/** True when source files sit in the project's folders (two levels down at most, a bounded look). */
function hasCodeBelow(root: string, folders: string[]): boolean {
  let budget = 2000;
  const look = (dir: string, depth: number): boolean => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (--budget < 0) return false;
      if (e.isFile() && isCode(e.name)) return true;
      if (e.isDirectory() && depth > 0 && !e.name.startsWith('.') && !IGNORED_FOLDERS.has(e.name) && look(join(dir, e.name), depth - 1)) return true;
    }
    return false;
  };
  return folders.filter((f) => f !== '.claude' && f !== '.actor').some((f) => look(join(root, f), 1));
}

function projectCommands(scripts: Record<string, string>, pm: Detection['packageManager'], py: Set<string>, stacks: Set<string>): Commands {
  const run = (script: string) => {
    if (pm === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
    if (pm === 'bun') return `bun run ${script}`;
    return `${pm} ${script}`;
  };
  const pick = (...names: string[]) => names.find((n) => n in scripts);
  const commands: Commands = {};
  const set = (key: keyof Commands, ...names: string[]) => {
    const script = pick(...names);
    if (script && pm) commands[key] = run(script);
  };
  set('dev', 'dev', 'start');
  set('build', 'build');
  set('test', 'test', 'test:unit');
  set('lint', 'lint');
  set('typecheck', 'typecheck', 'type-check', 'check-types', 'tsc', 'check');
  set('e2e', 'e2e', 'test:e2e');
  if (commands.test && /no test specified/.test(scripts.test ?? '')) delete commands.test;
  if (!commands.test && stacks.has('python') && stacks.has('tests')) commands.test = 'pytest';
  if (!commands.lint && py.has('ruff')) commands.lint = 'ruff check .';
  return commands;
}

/** "*.uproject" matches "Shooter.uproject"; names without wildcards match exactly (case-insensitive). */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, (c) => `\\${c}`);
  return new RegExp(`^${escaped.replaceAll('*', '[^/]*').replaceAll('?', '[^/]')}$`, 'i');
}

function scoreDomains(
  library: Library,
  p: { deps: Record<string, string>; rootFiles: string[]; folders: string[]; py: Set<string>; root: string },
): DomainMatch[] {
  const matches: DomainMatch[] = [];
  for (const domain of library.domains.values()) {
    if (!domain.detect) continue;
    const reasons: string[] = [];
    let score = 0;
    for (const dep of domain.detect.dependencies) {
      if (dep in p.deps) {
        score += 3;
        reasons.push(`depends on ${dep}`);
      }
    }
    for (const file of domain.detect.files) {
      const pattern = globToRegExp(file);
      const found = p.rootFiles.find((f) => pattern.test(f)) ?? p.folders.find((f) => pattern.test(f));
      if (found) {
        score += 3;
        reasons.push(`has ${found}`);
      }
    }
    for (const name of domain.detect.python) {
      if (p.py.has(name.toLowerCase())) {
        score += 3;
        reasons.push(`uses ${name} (Python)`);
      }
    }
    for (const [file, key] of Object.entries(domain.detect.json)) {
      const json = p.rootFiles.includes(file) ? readJson(join(p.root, file)) : null;
      if (json && key in json) {
        score += 4;
        reasons.push(`${file} has ${key}`);
      }
    }
    if (score > 0) matches.push({ id: domain.id, priority: domain.detect.priority, score, reasons });
  }
  // A specific kind of project (an AI app, a game, a mobile app) beats a general one even when it has fewer signals.
  return matches.sort((a, b) => b.priority - a.priority || b.score - a.score || a.id.localeCompare(b.id));
}
