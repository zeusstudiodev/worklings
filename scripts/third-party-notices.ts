// THIRD-PARTY-NOTICES.md: the licence notices for the code and fonts that Worklings' builds bundle. Their licences
// (MIT, ISC, BSD, Zlib, SIL OFL) ask that the copyright notice and licence text travel with copies, so every build
// carries this file: the npm package (the committed copy at the repository root), dist/web, dist/site and the plugin's
// runtime (the vite plugin below writes it next to each build's output).
//
//   node scripts/third-party-notices.ts            write THIRD-PARTY-NOTICES.md (prepack does this)
//   node scripts/third-party-notices.ts --check    fail when the committed file is stale (npm run check:notices)
//
// BUNDLED says which packages each build contains. It is checked against the real module graph on every build
// (`thirdPartyNotices` below stops a build that bundles a package not listed), so it cannot drift quietly: add the
// package here when that happens. The text comes from each package's own LICENSE file in node_modules, with the
// version and licence from its package.json. Nothing here reads the clock or the network, so the output is the same
// on every machine for the same lockfile.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ROOT = join(import.meta.dirname, '..');
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';

/** What each build bundles: the web app (dist/web, dist/site, the plugin's copy) and the CLI (the plugin's cli.mjs). */
export const BUNDLED = {
  web: [
    '@babel/runtime',
    '@react-three/drei',
    '@react-three/fiber',
    '@react-three/postprocessing',
    'its-fine',
    'maath',
    'n8ao',
    'postprocessing',
    'react',
    'react-dom',
    'react-use-measure',
    'scheduler',
    'suspend-react',
    'three',
    'three-stdlib',
    'use-sync-external-store',
    'yaml',
    'zustand',
  ],
  cli: ['smol-toml', 'yaml'],
} as const;

/** The fonts the web app's CSS pulls in (web/src/main.tsx); their font files ship in dist/web and dist/site. */
export const FONTS = ['@fontsource/barlow', '@fontsource/barlow-semi-condensed'] as const;

/** Licences that may be bundled. Anything else (GPL, AGPL, unknown) stops the script until someone decides. */
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'OFL-1.1', 'Apache-2.0', 'CC0-1.0', '0BSD']);

/** For a package that ships no licence file: the standard text of the licence its package.json declares. */
const STANDARD_TEXT: Record<string, (holder: string) => string> = {
  MIT: (holder) =>
    [
      'MIT License',
      '',
      `Copyright (c) ${holder}`,
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
      'documentation files (the "Software"), to deal in the Software without restriction, including without limitation',
      'the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and',
      'to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
      '',
      'The above copyright notice and this permission notice shall be included in all copies or substantial portions of',
      'the Software.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO',
      'THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF',
      'CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS',
      'IN THE SOFTWARE.',
    ].join('\n'),
};

export interface Notice {
  name: string;
  version: string;
  license: string;
  /** Where the package is used: any of 'web app', 'CLI', 'font'. */
  uses: string[];
  text: string;
  /** Set when the package ships no licence file, so the text is the standard one for its declared licence. */
  note: string | null;
}

const LICENSE_FILE = /^(licen[sc]e|copying)(\.(md|txt))?$/i;

const readJson = (file: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${file} isn't a JSON object.`);
  return value as Record<string, unknown>;
};

/** An author field is a string or { name }; "Name (url) <email>" is cut back to the name. */
function authorOf(pkg: Record<string, unknown>): string | null {
  const a = pkg.author;
  const raw = typeof a === 'string' ? a : typeof a === 'object' && a !== null && typeof (a as { name?: unknown }).name === 'string' ? (a as { name: string }).name : '';
  const name = raw.replace(/\s*[(<].*$/, '').trim();
  return name === '' ? null : name;
}

const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

function notice(root: string, name: string, uses: string[]): Notice {
  const dir = join(root, 'node_modules', ...name.split('/'));
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`${name} is bundled but isn't installed: run npm install.`);
  const pkg = readJson(join(dir, 'package.json'));
  const license = typeof pkg.license === 'string' ? pkg.license : '';
  const version = typeof pkg.version === 'string' ? pkg.version : '';
  if (!ALLOWED.has(license)) {
    throw new Error(`${name}@${version} is licensed "${license || 'unknown'}", which isn't on the list of licences that may be bundled (${[...ALLOWED].join(', ')}). Decide before shipping it.`);
  }
  const file = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort()[0];
  if (file) return { name, version, license, uses, text: clean(readFileSync(join(dir, file), 'utf8')), note: null };
  const standard = STANDARD_TEXT[license];
  if (!standard) throw new Error(`${name} ships no licence file and there is no standard ${license} text here to stand in: add one to STANDARD_TEXT.`);
  const upstream = Object.hasOwn(UPSTREAM_HOLDERS, name) ? UPSTREAM_HOLDERS[name] : undefined;
  const author = authorOf(pkg);
  const holder = upstream ?? author ?? `the ${name} authors`;
  const whose = upstream
    ? "the copyright line is the one in the project's own repository"
    : author
      ? 'the copyright holder is the author named in its package.json'
      : "its package.json names no author, so the holder is given as the package's authors";
  return { name, version, license, uses, text: standard(holder), note: `The package ships no licence file. This is the standard ${license} text; ${whose}.` };
}

/**
 * Copyright lines from the LICENSE in each project's own repository, for packages whose npm tarball leaves the file
 * out (read 11 Nov 2026: github.com/pmndrs/react-three-fiber, github.com/pmndrs/maath).
 */
const UPSTREAM_HOLDERS: Record<string, string> = {
  '@react-three/fiber': '2019-2025 Poimandres',
  maath: 'Isaac Mason',
};

/** Every bundled package with its notice, sorted by name. */
export function collectNotices(root = ROOT): Notice[] {
  const uses = new Map<string, Set<string>>();
  const add = (name: string, use: string) => uses.set(name, (uses.get(name) ?? new Set()).add(use));
  for (const name of BUNDLED.web) add(name, 'web app');
  for (const name of BUNDLED.cli) add(name, 'CLI');
  for (const name of FONTS) add(name, 'font');
  return [...uses].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, use]) => notice(root, name, [...use].sort()));
}

/** The notices as the Markdown that ships. */
export function renderNotices(notices: Notice[]): string {
  const out: string[] = [
    '# Third-party notices',
    '',
    'Worklings itself is released under the MIT licence (`LICENSE`); its 3D art is CC0 (`CREDITS.md`). The web app,',
    'the static demo, the plugin runtime and the command line bundle the third-party code and fonts below, and are',
    'distributed under these licences, whose notices follow. The list is the modules each build really contains,',
    'checked on every build; the licence texts are the ones the packages ship.',
    '',
    '| Package | Version | Licence | In |',
    '| --- | --- | --- | --- |',
    ...notices.map((n) => `| ${n.name} | ${n.version} | ${n.license} | ${n.uses.join(', ')} |`),
    '',
    'The fonts (Barlow and Barlow Semi Condensed, from Fontsource) are under the SIL Open Font License 1.1, whose full',
    'text is in the entries below. The CLI also needs `smol-toml` and `yaml` when installed from npm, where they arrive',
    'as ordinary dependencies; the plugin bundles them.',
  ];
  for (const n of notices) {
    out.push('', '---', '', `## ${n.name} ${n.version}`, '', `Licence: ${n.license}. In: ${n.uses.join(', ')}.`);
    if (n.note) out.push('', n.note);
    out.push('', ...n.text.split('\n').map((line) => (line === '' ? '' : `    ${line}`)));
  }
  return `${out.join('\n')}\n`;
}

export const notices = (root = ROOT): string => renderNotices(collectNotices(root));

/** The package a bundled module belongs to, or null for the project's own files and virtual modules. */
export function packageOf(id: string): string | null {
  const parts = id.split('?')[0]!.replace(/\\/g, '/').split('/node_modules/');
  const last = parts.length > 1 ? parts[parts.length - 1]! : id.replace(/\\/g, '/').startsWith('node_modules/') ? id.replace(/\\/g, '/').slice('node_modules/'.length) : null;
  if (last === null) return null;
  const segments = last.split('/');
  return segments[0]!.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

/**
 * For a vite build: stops it when it bundles a package the notices don't list for `build`, and writes the notices into
 * the build's output folder, so no build ships without them and none ships a stale list.
 */
export function thirdPartyNotices(build: keyof typeof BUNDLED): Plugin {
  const listed = new Set<string>([...BUNDLED[build], ...(build === 'web' ? FONTS : [])]);
  let text = '';
  return {
    name: 'worklings-third-party-notices',
    apply: 'build',
    buildStart() {
      text = notices();
    },
    generateBundle(_options, bundle) {
      const found = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const name = packageOf(id);
          if (name) found.add(name);
        }
      }
      const missing = [...found].filter((name) => !listed.has(name)).sort();
      if (missing.length > 0) {
        this.error(`This build bundles ${missing.join(', ')}, which scripts/third-party-notices.ts doesn't list for the ${build}: add it there (its licence must be on the allowed list) so the notices cover it.`);
      }
    },
    writeBundle({ dir }) {
      if (!dir) throw new Error('The build has no output folder for the third-party notices.');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, NOTICES_FILE), text);
    },
  };
}

function main(args: string[]): number {
  const file = join(ROOT, NOTICES_FILE);
  const text = notices();
  if (args.includes('--check')) {
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === text) {
      console.log(`${NOTICES_FILE} is up to date (${collectNotices().length} packages).`);
      return 0;
    }
    console.error(`${NOTICES_FILE} ${current === null ? 'is missing' : 'is stale'}: run node scripts/third-party-notices.ts and commit it.`);
    return 1;
  }
  writeFileSync(file, text);
  console.log(`${NOTICES_FILE} written: ${collectNotices().length} packages.`);
  return 0;
}

const isMain = () => {
  if (!process.argv[1]) return false;
  const [self, run] = [fileURLToPath(import.meta.url), resolve(process.argv[1])];
  return process.platform === 'win32' ? self.toLowerCase() === run.toLowerCase() : self === run;
};

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
