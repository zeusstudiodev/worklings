// Where the package's own files are. The CLI runs from src/ (development), from dist/ (the npm package) and as one
// bundled file in plugin/runtime/ (the Claude Code plugin), and each layout keeps the library, the web app and
// package.json in a different place relative to the running file.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function first(...candidates: string[]): string {
  const paths = candidates.map((c) => fileURLToPath(new URL(c, import.meta.url)));
  return paths.find((p) => existsSync(p)) ?? paths[0] ?? '';
}

/** The curated library: library/ at the package root, or next to the bundled runtime. */
export const LIBRARY_DIR = first('../library/', './library/');

/** The built web app: dist/web/ in the package, or web/ next to the bundled runtime. */
export const WEB_DIR = first('../dist/web/', './web/');

export const PACKAGE_JSON = first('../package.json', './package.json');
