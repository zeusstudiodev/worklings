#!/usr/bin/env node
// Development: the office API on 7422 (the demo, or the live office for a folder you pass) plus Vite on 4325 with
// hot reload, proxying /api, /events and /hooks to the API. Usage: npm run dev [-- <project folder>]
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadToken } from '../src/server/token.ts';

const root = join(import.meta.dirname, '..');
const folder = process.argv[2];
const api = folder
  ? ['--watch', 'src/cli.ts', 'office', folder, '--port', '7422', '--no-open']
  : ['--watch', 'src/cli.ts', 'demo', '--port', '7422', '--no-open'];

const children = [
  spawn(process.execPath, api, { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit' }),
];
// A live office shows only to its token (the demo is open to look at), so the link carries it.
const link = `http://localhost:4325/${folder ? `?token=${loadToken()}` : ''}`;
console.log(`\nOffice UI with hot reload: ${link}  (${folder ? `live office for ${folder}` : 'demo studio'})\n`);

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && code !== 0 && stop());
