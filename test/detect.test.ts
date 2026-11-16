import { describe, expect, it } from 'vitest';
import { detect } from '../src/composer/detect.ts';
import { loadLibrary } from '../src/composer/library.ts';
import { miniLibrary, tempDir, writeTree } from './library-kit.ts';
import { project } from './projects.ts';

describe('detect', () => {
  it('reads an Expo app: stack, versions, package manager, commands and folders', () => {
    const d = detect(project('expo'));
    expect(d.name).toBe('plant-pal');
    expect(d.isEmpty).toBe(false);
    expect(d.stacks).toEqual(expect.arrayContaining(['expo', 'react-native', 'react', 'typescript', 'node']));
    expect(d.frameworks).toEqual(expect.arrayContaining(['Expo 58.0.4', 'React Native 0.83.2', 'TypeScript 6.0.3']));
    expect(d.packageManager).toBe('npm');
    // A placeholder "no test specified" script is not a test command.
    expect(d.commands).toEqual({ dev: 'npm run start', lint: 'npm run lint', typecheck: 'npm run typecheck' });
    expect(d.folders).toEqual(['app', 'components']);
  });

  it('reads a React Router app on Workers with pnpm', () => {
    const d = detect(project('webApp'));
    expect(d.stacks).toEqual(expect.arrayContaining(['react', 'react-router', 'cloudflare-workers', 'sql', 'drizzle', 'tests', 'playwright']));
    expect(d.packageManager).toBe('pnpm');
    expect(d.commands).toMatchObject({ dev: 'pnpm dev', test: 'pnpm test', typecheck: 'pnpm typecheck', e2e: 'pnpm e2e' });
  });

  it.each([
    ['website', ['astro']],
    ['webGame', ['phaser', 'vite', 'typescript']],
    ['godot', ['godot']],
    ['unity', ['unity']],
    ['unreal', ['unreal']],
    ['pythonApi', ['python', 'fastapi', 'sql', 'tests']],
    ['extension', ['chrome-extension']],
    ['cli', ['cli', 'library', 'typescript']],
    ['dataMl', ['python', 'pytorch', 'pandas', 'sklearn', 'jupyter']],
    ['aiApp', ['llm', 'nextjs', 'react']],
    ['desktop', ['tauri', 'react']],
    ['automation', ['crawlee', 'playwright', 'apify']],
  ] as const)('finds the %s stack', (name, stacks) => {
    expect(detect(project(name)).stacks).toEqual(expect.arrayContaining([...stacks]));
  });

  it('names engines and Python projects', () => {
    expect(detect(project('unity')).frameworks).toContain('Unity 6000.0.30f1');
    const py = detect(project('pythonApi'));
    expect(py.name).toBe('orders-api');
    expect(py.commands).toEqual({ test: 'pytest', lint: 'ruff check .' });
  });

  it('treats an empty folder as a new project', () => {
    const d = detect(tempDir());
    expect(d).toMatchObject({ isEmpty: true, stacks: [], packageManager: null, commands: {}, domains: [] });
    expect(detect(writeTree(tempDir(), { 'README.md': '# Idea', 'docs/plan.md': 'later' })).isEmpty).toBe(true);
  });

  it('sees code that lives only in subfolders', () => {
    expect(detect(writeTree(tempDir(), { 'src/index.js': 'console.log(1)\n' })).isEmpty).toBe(false);
    expect(detect(writeTree(tempDir(), { 'packages/core/main.go': 'package main\n' })).isEmpty).toBe(false);
  });

  it('reads Python dependencies where they are declared, never from prose', () => {
    const quiet = writeTree(tempDir(), {
      'pyproject.toml': [
        '[project]',
        'name = "quiet-cli"',
        'description = "A click CLI; no openai or torch here"',
        'dependencies = ["click>=8", "rich[jupyter]>=13 ; python_version > \'3.9\'"]',
        '# fastapi would be overkill',
        '[project.optional-dependencies]',
        'dev = ["pytest>=8"]',
      ].join('\n'),
    });
    const d = detect(quiet);
    expect(d.name).toBe('quiet-cli');
    expect(d.stacks).toContain('tests');
    expect(d.stacks).not.toEqual(expect.arrayContaining(['llm']));
    expect(d.stacks).not.toEqual(expect.arrayContaining(['pytorch']));
    expect(d.stacks).not.toEqual(expect.arrayContaining(['fastapi']));
    const poetry = writeTree(tempDir(), { 'pyproject.toml': '[tool.poetry]\nname = "svc"\n[tool.poetry.dependencies]\npython = "^3.12"\nFastAPI = "^0.110"\n' });
    expect(detect(poetry)).toMatchObject({ name: 'svc', stacks: expect.arrayContaining(['fastapi']) });
    const legacy = writeTree(tempDir(), {
      'requirements.txt': '# torch would be nice\n-r base.txt\nDjango==5.1  # the web part\n',
      'setup.py': 'setup(name="x", description="pandas", install_requires=["openai[datalib]>=1", "fastapi"])\n',
    });
    expect(detect(legacy).stacks).toEqual(expect.arrayContaining(['django', 'llm', 'fastapi']));
    expect(detect(legacy).stacks).not.toEqual(expect.arrayContaining(['pandas']));
    expect(detect(legacy).stacks).not.toEqual(expect.arrayContaining(['pytorch']));
  });

  it("isn't thrown by names that are also on Object.prototype", () => {
    const root = writeTree(tempDir(), {
      'pyproject.toml': '[project]\nname = "constructor"\ndependencies = ["constructor", "toString"]\n',
      'package.json': JSON.stringify({ name: 'x', dependencies: { constructor: '1.0.0', __proto__: '1.0.0', valueOf: '1' } }),
    });
    expect(() => detect(root, loadLibrary())).not.toThrow();
  });

  it('scores domains from the library detect signals', () => {
    const lib = loadLibrary(miniLibrary());
    expect(detect(project('expo'), lib).domains).toEqual([{ id: 'mini-app', priority: 0, score: 6, reasons: ['depends on expo', 'has app.json'] }]);
    expect(detect(project('webGame'), lib).domains).toEqual([]);
  });
});

describe('detect with the shipped library', () => {
  const library = loadLibrary();
  it.each([
    ['expo', 'mobile-app'],
    ['webApp', 'web-app'],
    ['website', 'website'],
    ['webGame', 'web-game'],
    ['godot', 'engine-game'],
    ['unity', 'engine-game'],
    ['unreal', 'engine-game'],
    ['pythonApi', 'api-service'],
    ['extension', 'browser-extension'],
    ['cli', 'cli-library'],
    ['dataMl', 'data-ml'],
    ['aiApp', 'ai-app'],
    ['desktop', 'desktop-app'],
    ['automation', 'automation'],
  ] as const)('recognises the %s project as %s', (name, domain) => {
    expect(detect(project(name), library).domains[0]?.id).toBe(domain);
  });
});
