import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath, type Plugin, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { thirdPartyNotices } from './scripts/third-party-notices.ts';

// The dev API server (scripts/dev.mjs) listens on 7422 so it can run beside an installed office on the default 7421.
const api = 'http://127.0.0.1:7422';

/** The office: what `worklings` serves from dist/web, and `npm run dev`. */
const office: UserConfig = {
  root: 'web',
  plugins: [react(), thirdPartyNotices('web')],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // One chunk of about 340 kB gzipped, mostly three.js. It is served from localhost, so splitting it buys nothing.
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 4325,
    strictPort: true,
    proxy: { '/api': api, '/events': api, '/hooks': api },
  },
};

export default defineConfig(({ mode }) => (mode === 'site' ? site() : office));

// ---------------------------------------------------------------------------------------------------------------
// The static web demo (`npm run build:site`, into dist/site): the demo lobby and company from plain files, with no
// server and no Claude Code, for GitHub Pages at https://zeusstudiodev.github.io/worklings/. Another address builds with
// `npm run build:site -- --base /other/`; `/` suits a domain of its own.

/** A path in the project, wherever the build runs from. */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

async function site(): Promise<UserConfig> {
  // The office's policy, loaded by Node for this build only: the office's own builds never load the server's modules.
  const { CSP } = (await import(new URL('./src/server/http.ts', import.meta.url).href)) as typeof import('./src/server/http.ts');
  return {
    root: here('web/site'),
    base: '/worklings/',
    publicDir: '../public',
    plugins: [react(), siteRouter(), sitePolicy(CSP), pagesFiles(), thirdPartyNotices('web')],
    build: {
      outDir: '../../dist/site',
      emptyOutDir: true,
      // three.js comes in its own chunk with the office, after the lobby has drawn.
      chunkSizeWarningLimit: 1400,
    },
  };
}

const ROUTER = here('web/src/company/router.ts');
const SITE_ROUTER = here('web/src/site/router.ts');
const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * The app's views write their own addresses ("/c/demo/inbox"), while the site lives under a base path. Every import of
 * the app's router (web/src/company/router.ts) gets the site's (web/src/site/router.ts), which adds the base on the way
 * out and takes it off on the way in; only the site's router imports the app's own. A build where nothing was swapped
 * stops, since its views would leave the base.
 */
function siteRouter(): Plugin {
  let building = false;
  let swapped = 0;
  return {
    name: 'worklings-site-router',
    enforce: 'pre',
    configResolved({ command }) {
      building = command === 'build';
    },
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('/router.ts')) return null;
      const from = resolve(importer.split('?')[0] ?? importer);
      if (samePath(from, SITE_ROUTER) || !samePath(resolve(dirname(from), source), ROUTER)) return null;
      swapped += 1;
      return normalizePath(SITE_ROUTER);
    },
    buildEnd(error) {
      if (!error && building && swapped === 0) throw new Error("No import of web/src/company/router.ts was given the site's router (web/src/site/router.ts).");
    },
  };
}

/** Directives only a response header can carry: browsers ignore them in a <meta> element and say so in the console. */
const HEADER_ONLY = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

/**
 * Pages sends none of the office's headers, so the office's policy (src/server/http.ts) goes in a <meta> element ahead
 * of every script and style, less what only a header can say. It keeps 'wasm-unsafe-eval' for three's meshopt decoder.
 */
function sitePolicy(csp: string): Plugin {
  const policy = csp
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '' && !HEADER_ONLY.has(directive.split(/\s+/)[0] ?? ''))
    .join('; ');
  return {
    name: 'worklings-site-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  };
}

/**
 * Pages answers an address it has no file for with 404.html, so a copy of index.html there opens the app on any view
 * after a reload or from a shared link; .nojekyll has Pages serve the files as they are. The assets' addresses start
 * with the base, since that copy is served at every depth.
 */
function pagesFiles(): Plugin {
  return {
    name: 'worklings-pages-files',
    apply: 'build',
    configResolved({ base }) {
      if (!/^\/([\w.~-]+\/)*$/.test(base)) {
        throw new Error(`The site's base must be a path such as /worklings/, not "${base}": 404.html is served at every depth, so its assets can't be relative.`);
      }
      const first = base.split('/')[1];
      if (first === 'c' || first === 'new') throw new Error(`The base ${base} would read as one of the app's own addresses. Pick another.`);
    },
    writeBundle({ dir }) {
      if (!dir) throw new Error('The site build has no output folder.');
      copyFileSync(join(dir, 'index.html'), join(dir, '404.html'));
      writeFileSync(join(dir, '.nojekyll'), '');
    },
  };
}
