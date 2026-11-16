// Small fake projects, one per kind of stack, written to temp folders.
import { tempDir, writeTree } from './library-kit.ts';

export const PROJECTS: Record<string, Record<string, string | object>> = {
  expo: {
    'package.json': {
      name: 'plant-pal',
      scripts: { start: 'expo start', lint: 'expo lint', typecheck: 'tsc --noEmit', test: 'echo "Error: no test specified" && exit 1' },
      dependencies: { expo: '~58.0.4', 'expo-router': '~6.0.0', react: '19.3.1', 'react-native': '0.83.2' },
      devDependencies: { typescript: '~6.0.3' },
    },
    'package-lock.json': '{}',
    'app.json': { expo: { name: 'Plant Pal' } },
    'tsconfig.json': '{}',
    'app/index.tsx': 'export default function Home() { return null; }',
    'components/Button.tsx': '',
  },
  webApp: {
    'package.json': {
      name: 'itinerary',
      scripts: { dev: 'react-router dev', build: 'react-router build', test: 'vitest run', typecheck: 'tsc -b', e2e: 'playwright test' },
      dependencies: { react: '^19.3.1', 'react-dom': '^19.3.1', 'react-router': '^8.1.0', 'drizzle-orm': '^1.0.0' },
      devDependencies: { '@react-router/dev': '^8.1.0', wrangler: '^4.50.0', vitest: '^5.1.0', '@playwright/test': '^1.64.1', typescript: '~6.0.3' },
    },
    'pnpm-lock.yaml': '',
    'wrangler.jsonc': '{}',
    'app/root.tsx': '',
    'migrations/0001.sql': '',
  },
  website: { 'package.json': { name: 'site', dependencies: { astro: '^7.0.0' }, scripts: { dev: 'astro dev', build: 'astro build' } }, 'astro.config.mjs': '', 'src/pages/index.astro': '' },
  webGame: { 'package.json': { name: 'charm', dependencies: { phaser: '^4.0.0' }, devDependencies: { vite: '^8.0.0', typescript: '~6.0.3' } }, 'src/main.ts': '' },
  godot: { 'project.godot': 'config_version=5', 'scenes/main.tscn': '' },
  unity: { 'Assets/Scripts/Player.cs': '', 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.0.30f1\n' },
  unreal: { 'Shooter.uproject': '{}', 'Source/Shooter/Shooter.cpp': '' },
  pythonApi: { 'pyproject.toml': '[project]\nname = "orders-api"\ndependencies = ["fastapi>=0.120", "SQLAlchemy", "pytest", "ruff"]\n', 'tests/test_app.py': '', 'app/main.py': '' },
  extension: { 'manifest.json': { manifest_version: 3, name: 'Comps' }, 'package.json': { name: 'comps', devDependencies: { '@types/chrome': '^0.1.0' } }, 'src/background.ts': '' },
  cli: { 'package.json': { name: 'mytool', bin: { mytool: 'dist/cli.js' }, main: 'dist/index.js', devDependencies: { typescript: '~6.0.3' } }, 'src/cli.ts': '' },
  dataMl: { 'requirements.txt': 'torch==2.9\npandas\nscikit-learn\njupyter\n', 'notebooks/explore.ipynb': '{}', 'train.py': '' },
  aiApp: { 'package.json': { name: 'helper', dependencies: { '@anthropic-ai/sdk': '^1.2.0', next: '^16.0.0', react: '^19.3.1', 'react-dom': '^19.3.1' } }, 'next.config.ts': '', 'app/page.tsx': '' },
  desktop: { 'package.json': { name: 'notes', dependencies: { '@tauri-apps/api': '^2.9.0', react: '^19.3.1', 'react-dom': '^19.3.1' } }, 'src-tauri/Cargo.toml': '', 'src/App.tsx': '' },
  automation: { 'package.json': { name: 'scraper', dependencies: { crawlee: '^3.15.0', playwright: '^1.64.1', apify: '^3.5.0' } }, '.actor/actor.json': '{}', 'src/main.ts': '' },
};

export function project(name: keyof typeof PROJECTS): string {
  return writeTree(tempDir(), PROJECTS[name] ?? {});
}
