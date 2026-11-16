#!/usr/bin/env node
// Records Claude Code http-hook payloads, one JSON file per event, so test fixtures can be refreshed when Claude Code
// changes. See docs/claude-code-surfaces.md for the full procedure.
// Usage: node scripts/capture-hooks.mjs <out-dir> [port=7499] [idle-seconds=120]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [outDir = 'captured-hooks', port = '7499', idleSeconds = '120'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

let count = 0;
let idleTimer;
const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    count += 1;
    let event;
    try {
      event = JSON.parse(body).hook_event_name ?? 'no-event-name';
    } catch {
      event = 'invalid-json';
    }
    const file = join(outDir, `${String(count).padStart(3, '0')}-${event}.json`);
    writeFileSync(file, body);
    console.log(`${count} ${event}`);
    res.writeHead(200).end();
    armIdleTimer();
  });
});

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => server.close(() => console.log(`idle, stopped after ${count} events`)), Number(idleSeconds) * 1000);
}

server.listen(Number(port), '127.0.0.1', () => {
  console.log(`capturing on http://127.0.0.1:${port}/hooks into ${outDir}`);
  armIdleTimer();
});
