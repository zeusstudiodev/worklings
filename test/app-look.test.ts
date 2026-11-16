// v0.3, "See the app" (SPEC-v0.3.md, Q1): the office runs a project's app and looks at it in headless Chromium at 375 and
// 1440 px, drives the checklist's walks, keeps screenshots and console errors, and stops the app. This runs a real (tiny) app
// and a real browser, so it takes a few seconds.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { lookApp } from '../src/company/app-look.ts';
import { tempDir } from './library-kit.ts';

const SERVER = `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
writeFileSync(join(tmpdir(), 'PIDNAME'), String(process.pid));
writeFileSync('data.db', 'the app writes where it runs');
const books = [];
const page = (body) => '<!doctype html><meta name="viewport" content="width=device-width"><title>Club</title>' + body;
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { books.push(new URLSearchParams(data).get('title')); res.writeHead(303, { location: '/' }); res.end(); });
    return;
  }
  if (url.pathname !== '/') { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page('<h1>Book club</h1><script>console.error("boom: the vote widget failed")</script><img src="https://example.invalid/x.png" alt=""><form method="post"><label>Title <input name="title"></label><button>Suggest</button></form><ul>' + books.map((b) => '<li>' + b + '</li>').join('') + '</ul>'));
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening on http://127.0.0.1:' + process.env.PORT));
`;

function project(scripts: Record<string, string>, server = SERVER): string {
  const root = tempDir('look');
  server = server.replace('PIDNAME', `look-test-${basename(root)}.pid`);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'club', type: 'module', scripts }));
  writeFileSync(join(root, 'server.mjs'), server);
  // Installed already: the look installs only when node_modules is missing.
  mkdirSync(join(root, 'node_modules'));
  return root;
}

describe('the office looking at the app', () => {
  it('opens it at both widths, drives a walk, keeps the screenshots and console errors, and stops it', async () => {
    const root = project({ start: 'node server.mjs' });
    const out = join(root, '.worklings-shared', 'looks', 't-9-1');
    const result = await lookApp({
      root,
      outDir: out,
      person: 'lea',
      branch: null,
      walks: [
        { item: 'k-1', page: '/', steps: ['fill "Title" with "Dune {unique}"', 'click "Suggest"', 'see "Dune"'] },
        { item: 'k-2', page: '/', steps: ['click "Vote"', 'see "1 vote"'] },
      ],
    });
    expect(result.state).toBe('seen');
    expect(result.shots.map((s) => [s.file, s.width])).toEqual([
      ['.worklings-shared/looks/t-9-1/home-phone.png', 375],
      ['.worklings-shared/looks/t-9-1/home-desktop.png', 1440],
    ]);
    expect(result.shots[0]?.overflow).toBe(false);
    for (const s of result.shots) expect(existsSync(join(root, s.file))).toBe(true);
    expect(result.errors.some((e) => e.includes('boom: the vote widget failed'))).toBe(true);
    // Nothing beyond this computer is fetched: the outside image is blocked, not loaded.
    expect(result.walks).toEqual([
      { item: 'k-1', ok: true, step: null, why: null, shot: '.worklings-shared/looks/t-9-1/walk-k-1.png' },
      { item: 'k-2', ok: false, step: 'click "Vote"', why: 'no button or link named "Vote" could be clicked', shot: '.worklings-shared/looks/t-9-1/walk-k-2-failed.png' },
    ]);
    expect(result.note).toContain('1 of 2 acceptance walks passed');
    // The app is stopped with everything it started.
    const pid = Number(readFileSync(join(tmpdir(), `look-test-${basename(root)}.pid`), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    // It ran in a throwaway copy: what it wrote isn't in the project, and the project's packages are still there.
    expect(existsSync(join(root, 'data.db'))).toBe(false);
    expect(existsSync(join(root, 'node_modules'))).toBe(true);
  }, 90_000);

  it('skips a project that is not a web app, with a plain note', async () => {
    const root = tempDir('look-lib');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'lib', scripts: { test: 'vitest' } }));
    const result = await lookApp({ root, outDir: join(root, '.worklings-shared', 'looks', 'x'), person: 'lea', branch: null, walks: [] });
    expect(result).toMatchObject({ state: 'skipped', shots: [], walks: [] });
    expect(result.note).toContain('no dev or start script');
  });

  it('does not start a dev script that would listen beyond this computer', async () => {
    const root = project({ dev: 'vite --host' });
    const result = await lookApp({ root, outDir: join(root, '.worklings-shared', 'looks', 'x'), person: 'lea', branch: null, walks: [] });
    expect(result.state).toBe('skipped');
    expect(result.note).toContain('every network');
  });

  it('fails when a web app ends before it serves a page, and runs no walk, so no maker is sent a fix for it', async () => {
    const root = project({ start: 'node server.mjs' }, 'console.error("Error: cannot open the database"); process.exit(1);');
    const result = await lookApp({ root, outDir: join(root, '.worklings-shared', 'looks', 'x'), person: 'lea', branch: null, walks: [{ item: 'k-1', page: '/', steps: ['see "Book club"'] }] });
    expect(result.state).toBe('failed');
    expect(result.note).toContain('before it served a page: Error: cannot open the database');
    expect(result.note).toContain('No walk ran.');
    expect(result.walks).toEqual([]);
  }, 60_000);

  it('skips a command-line tool whose start script ends at once, when the checklist has no walk', async () => {
    const root = project({ start: 'node server.mjs' }, 'console.log("usage: linkcheck <paths>"); process.exit(2);');
    const result = await lookApp({ root, outDir: join(root, '.worklings-shared', 'looks', 'x'), person: 'lea', branch: null, walks: [] });
    expect(result.state).toBe('skipped');
    expect(result.note).toContain('Not a web app the office can open');
  }, 60_000);

  it('stops an app that says it listens on every network', async () => {
    const wide = "import { createServer } from 'node:http'; createServer((q, r) => r.end('hi')).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('Network: http://0.0.0.0:' + process.env.PORT));";
    const root = project({ start: 'node server.mjs' }, wide);
    const result = await lookApp({ root, outDir: join(root, '.worklings-shared', 'looks', 'x'), person: 'lea', branch: null, walks: [] });
    expect(result.state).toBe('skipped');
    expect(result.note).toContain('listens on every network');
  }, 60_000);
});
