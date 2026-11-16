#!/usr/bin/env node
// Turns a capture run (scripts/capture-hooks.mjs plus the session's transcripts) into sanitised test fixtures:
// machine paths become /project and ~, transcript entries the tests don't read are dropped, thinking signatures go.
// Usage: node scripts/refresh-fixtures.mjs <captured-hooks-dir> <main-transcript.jsonl> <claude-version>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [hooksDir, mainTranscript, version] = process.argv.slice(2);
if (!hooksDir || !mainTranscript || !version) {
  console.error('usage: refresh-fixtures.mjs <captured-hooks-dir> <main-transcript.jsonl> <claude-version>');
  process.exit(2);
}

const out = join(import.meta.dirname, '..', 'test', 'fixtures', `claude-${version}`);
const firstHook = JSON.parse(readFileSync(join(hooksDir, readdirSync(hooksDir).sort()[0]), 'utf8'));
const cwd = firstHook.cwd;
// Claude Code names a project's transcript folder after its path with every non-alphanumeric character replaced.
const encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, '-');
const home = homedir();

// Longest first, so the project folder inside the transcript folder is replaced before the home folder.
const replacements = [
  [encodedCwd, '-project'],
  [cwd, '/project'],
  [home, '~'],
].flatMap(([from, to]) => [
  [from, to],
  [from.replaceAll('\\', '/'), to],
]).sort((a, b) => b[0].length - a[0].length);

function clean(value) {
  if (typeof value === 'string') {
    let s = value;
    for (const [from, to] of replacements) s = s.split(from).join(to);
    return s.replaceAll('\\', '/');
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'signature') continue;
      result[k] = clean(v);
    }
    return result;
  }
  return value;
}

const KEEP = new Set(['user', 'assistant']);
function cleanTranscript(src, dest) {
  const lines = readFileSync(src, 'utf8').split('\n').filter(Boolean);
  const kept = lines.map((l) => JSON.parse(l)).filter((e) => KEEP.has(e.type)).map(clean);
  writeFileSync(dest, kept.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return kept.length;
}

mkdirSync(join(out, 'hooks'), { recursive: true });
for (const file of readdirSync(hooksDir).sort()) {
  const payload = clean(JSON.parse(readFileSync(join(hooksDir, file), 'utf8')));
  writeFileSync(join(out, 'hooks', file), JSON.stringify(payload, null, 2) + '\n');
}

mkdirSync(join(out, 'transcripts', 'subagents'), { recursive: true });
const mainCount = cleanTranscript(mainTranscript, join(out, 'transcripts', 'main.jsonl'));
const subDir = join(mainTranscript.replace(/\.jsonl$/, ''), 'subagents');
let subCount = 0;
if (existsSync(subDir)) {
  for (const file of readdirSync(subDir)) {
    const src = join(subDir, file);
    if (file.endsWith('.jsonl')) subCount += cleanTranscript(src, join(out, 'transcripts', 'subagents', file));
    else if (file.endsWith('.meta.json')) {
      writeFileSync(join(out, 'transcripts', 'subagents', file), JSON.stringify(clean(JSON.parse(readFileSync(src, 'utf8'))), null, 2) + '\n');
    }
  }
}
console.log(`hooks: ${readdirSync(hooksDir).length}, main transcript entries: ${mainCount}, subagent entries: ${subCount} -> ${out}`);
