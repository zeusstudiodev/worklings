#!/usr/bin/env node
// Turns a run recorded by scripts/record-demo-run.mjs into the static demo's replay fixture
// (web/src/company/replay/recording.json; SPEC-v0.8.md, "The demo replay"). Free: it reads files and writes one.
//
//   node scripts/make-demo-replay.mjs --in <the recording's folder> [--out web/src/company/replay/recording.json]
//
// Sanitizing: the temp project's path becomes C:\Users\you\Projects\haiku-check in every spelling (backslashes, slashes,
// Claude Code's dashed folder names), the throwaway home and this machine's home become C:\Users\you, the user name
// becomes "you", session ids become made-up ones, and the hub's token never stays. Then it refuses to write if its own scan
// (the user name, the home folder, AppData, the temp folder, the token) or the privacy scan (scripts/check-public.mjs)
// finds anything. Frames are stored as changes from the frame before, with times relative to the first frame's arrival.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scanFiles } from './check-public.mjs';

const { values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string', default: 'web/src/company/replay/recording.json' } } });
if (!values.in) throw new Error('--in names the recording folder (raw.jsonl and run.json).');
const folder = resolve(values.in);
const run = JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8'));
const raw = readFileSync(join(folder, 'raw.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
if (raw.length === 0) throw new Error('The recording has no frames.');
const token = /token=([A-Za-z0-9_-]{16,})/.exec(readFileSync(join(folder, 'hub.log'), 'utf8'))?.[1] ?? null;
if (!token) console.warn("hub.log names no token, so the scan can't look for it: check that the recording's hub printed its link.");

const FAKE_HOME = 'C:\\Users\\you';
const FAKE_ROOT = `${FAKE_HOME}\\Projects\\haiku-check`;
const root = raw[0].snapshot.project.root;
const scratch = run.scratch;
const home = homedir();
const user = userInfo().username;

/** Every spelling of a Windows path: as written, with slashes, in a shell's /c/ form, and as Claude Code's dashed folder name. */
function spellings(path, fake) {
  const back = path.replace(/\//g, '\\');
  const fwd = back.replace(/\\/g, '/');
  const fakeFwd = fake.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):/.exec(back)?.[1] ?? 'C';
  const dashed = back.replace(/[:\\/.]/g, '-');
  const fakeDashed = fake.replace(/[:\\/.]/g, '-');
  return [
    [back, fake],
    [fwd, fakeFwd],
    [`/${drive.toLowerCase()}${fwd.slice(2)}`, `/c${fakeFwd.slice(2)}`],
    [dashed, fakeDashed],
  ];
}
// Longest first, so the project's path goes before the folders it is in.
const swaps = [...spellings(root, FAKE_ROOT), ...spellings(join(scratch, 'home'), FAKE_HOME), ...spellings(join(scratch, 'projects'), `${FAKE_HOME}\\Projects`), ...spellings(scratch, `${FAKE_HOME}\\Projects`), ...spellings(home, FAKE_HOME)].sort((a, b) => b[0].length - a[0].length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strings in, strings out: every swap, ignoring case (Windows paths), then the user name as a word, then session ids. */
const ids = new Map();
function clean(text) {
  let out = text;
  for (const [from, to] of swaps) out = out.replace(new RegExp(escapeRe(from), 'gi'), to.replace(/\$/g, '$$$$'));
  out = out.replace(new RegExp(`\\b${escapeRe(user)}\\b`, 'gi'), 'you');
  // What is left of a temp path whose end was cut off (a summary cut short mid-path): the fake projects folder.
  out = out.replace(/(?:[A-Za-z]:)?([\\/])Users\1you\1AppData(?:\1[\w.-]*)*/gi, (_m, sep) => ['C:', 'Users', 'you', 'Projects'].join(sep));
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (id) => {
    if (!ids.has(id)) ids.set(id, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
    return ids.get(id);
  });
  if (token) out = out.split(token).join('');
  return out;
}
/** Walks a value, cleaning every string (paths sit inside JSON strings, so JSON's own escaping never gets in the way). */
const walk = (v) => (typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), walk(x)])) : v);

// The office's own records of the hub that the demo never shows: kept empty, so nothing from this machine rides along.
const quiet = (s) => ({ ...s, sessions: [], hooks: { lastEventAt: null, ignored: 0 }, mode: 'demo' });

/** A change from `a` to `b`: {$:v} replaces, {o:{k:patch}, d:[k]} patches an object, {a:{i:patch}, n:len} an array. */
function diff(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (plain(a) && plain(b)) {
    const o = {};
    const d = Object.keys(a).filter((k) => !(k in b));
    for (const k of Object.keys(b)) {
      const p = k in a ? diff(a[k], b[k]) : { $: b[k] };
      if (p !== undefined) o[k] = p;
    }
    return d.length > 0 ? { o, d } : { o };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const at = {};
    for (let i = 0; i < b.length; i++) {
      const p = i < a.length ? diff(a[i], b[i]) : { $: b[i] };
      if (p !== undefined) at[i] = p;
    }
    const patch = { a: at, n: b.length };
    // An array that changed nearly everywhere is cheaper replaced.
    return JSON.stringify(patch).length < JSON.stringify(b).length ? patch : { $: b };
  }
  return { $: b };
}

const t0 = raw[0].at;
let before = null;
const frames = [];
for (const { at, snapshot } of raw) {
  const s = walk(quiet(snapshot));
  frames.push(before === null ? { t: 0, full: s } : { t: at - t0, patch: diff(before, s) ?? { o: {} } });
  before = s;
}
const last = raw.at(-1).snapshot.company;
const spend = last.people.reduce((sum, p) => sum + p.cost, 0) + (last.helpers ?? []).reduce((sum, h) => sum + h.costUsd, 0);
const fixture = {
  about: 'One real plain job, recorded once through a throwaway hub (scripts/record-demo-run.mjs) and sanitized (scripts/make-demo-replay.mjs); the static demo replays it sped up.',
  prompt: clean(run.prompt),
  folder: FAKE_ROOT,
  recorded: new Date(run.startedAt).toISOString().slice(0, 10),
  model: 'Sonnet',
  todoTools: true,
  durationMs: raw.at(-1).at - t0,
  costUsd: Math.round(spend * 100) / 100,
  // Times in the frames are the recording's; the player moves them to now (any number between these two is a time).
  timeRange: [t0 - 7 * 86_400_000, raw.at(-1).at + 7 * 86_400_000],
  frames,
};
const text = `${JSON.stringify(fixture)}\n`;

// Our own scan first: nothing of this machine, the run's folders or the token.
// The machine's name only when it is long enough to mean something (a two-letter name matches inside ordinary words).
const forbidden = [user, home, home.replace(/\\/g, '/'), ...(hostname().length >= 4 ? [hostname()] : []), 'AppData', 'worklings-record', scratch, ...(token ? [token] : [])];
const found = forbidden.filter((f) => f && text.toLowerCase().includes(f.toLowerCase()));
if (found.length > 0) {
  // Where, with the term itself masked, so the message doesn't repeat what it guards.
  for (const f of found) {
    const at = text.toLowerCase().indexOf(f.toLowerCase());
    console.error(`term ${forbidden.indexOf(f)}: …${text.slice(Math.max(0, at - 80), at + f.length + 80).split(f).join('<term>')}…`);
  }
  throw new Error(`Not written: the fixture still holds ${found.length} private term(s). Fix the sanitizer first.`);
}
const out = resolve(values.out);
const scan = scanFiles([{ path: values.out.replace(/\\/g, '/'), read: () => Buffer.from(text) }]);
if (scan.hits > 0) {
  // The draft goes to the temp folder, never beside the app, where it could be committed.
  const draft = join(tmpdir(), `demo-replay-${Date.now()}.json`);
  writeFileSync(draft, text);
  console.error(scan.lines.join('\n'));
  throw new Error(`Not written: the privacy scan found ${scan.hits} hit(s). The draft is at ${draft}; delete it once fixed.`);
}
writeFileSync(out, text);
console.log(`${out}: ${frames.length} frames over ${Math.round(fixture.durationMs / 1000)} s, $${fixture.costUsd}, ${Math.round(text.length / 1024)} kB`);
