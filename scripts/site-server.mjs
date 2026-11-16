#!/usr/bin/env node
// Serves the static web demo (dist/site, `npm run build:site`) the way GitHub Pages serves a project site, for its
// Playwright spec (test/site) and for a look by hand: files under the base path, a base without its slash redirected
// to it, 404.html with status 404 for any other address under the base, nothing outside it, and no headers of the
// office's own: the site's policy has to work from its <meta> element. Usage:
//   node scripts/site-server.mjs [--port 4393] [--base /worklings/] [--dir dist/site]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4393' },
    base: { type: 'string', default: '/worklings/' },
    dir: { type: 'string', default: 'dist/site' },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`--port takes a port number, not ${values.port}.`);
const base = values.base.endsWith('/') ? values.base : `${values.base}/`;
if (!base.startsWith('/')) throw new Error(`--base takes a path such as /worklings/, not ${values.base}.`);
const root = resolve(values.dir);
if (!existsSync(join(root, 'index.html')) || !existsSync(join(root, '404.html'))) {
  throw new Error(`${root} has no built site. Run npm run build:site first.`);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** The file a path under the base names, if it is one inside the site: Pages serves a folder's index.html. */
function fileOf(rest) {
  let path;
  try {
    path = decodeURIComponent(rest);
  } catch {
    return null;
  }
  const target = resolve(root, `.${sep}${path}`);
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (!existsSync(target)) return null;
  const stat = statSync(target);
  if (stat.isFile()) return target;
  const index = join(target, 'index.html');
  return stat.isDirectory() && existsSync(index) ? index : null;
}

function send(req, res, status, file) {
  const stat = statSync(file);
  res.writeHead(status, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': String(stat.size),
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed.');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (`${url.pathname}/` === base) {
    res.writeHead(301, { location: `${base}${url.search}` });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Not found: the site is under ${base}.`);
    return;
  }
  const file = fileOf(url.pathname.slice(base.length));
  if (file) send(req, res, 200, file);
  else send(req, res, 404, join(root, '404.html'));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`The static web demo: http://127.0.0.1:${port}${base} (${root})`);
});
const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
