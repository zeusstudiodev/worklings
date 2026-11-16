// The project's "dev server" for the preview spec: a page on a port of its own, printing its address the way Vite does.
import { createServer } from 'node:http';

const port = Number(process.env.E2E_DEV_APP_PORT);
createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Plant Pal</title><h1>Plant Pal preview</h1><p id="path">${req.url}</p>`);
}).listen(port, '127.0.0.1', () => console.log(`  Local:   http://127.0.0.1:${port}/`));
