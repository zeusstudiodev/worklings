// The v0.9 film's director for the real run. It plays the stakeholder against a throwaway hub (its own home folder and
// port), one empty project in C:\Projects and the real Claude Code on Sonnet (ANTHROPIC_MODEL), signed in as usual. It
// never moves CLAUDE_CONFIG_DIR and never reads credentials. It costs money: it pauses the job once its spend passes --cap.
//
// While the job runs it films, at 60 fps: A, the desk close up in 16:9 (HUD hidden, the film camera); B, the same in 9:16;
// C, the task board with the helpers' live costs; D, a phone at the npm test prompt, tapped Allow once; then the finished
// job's last words. The web app is built with VITE_WORKLINGS_FILM=1 for the take and built again plainly afterwards.
//
//   node director.mjs --out <folder> [--cap 4] [--port 4396] [--fake]
// --fake plays the session with test/fake-desk.mjs instead (free), to check the director itself.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, record, REPO, sleep, HIDE_HUD } from './lib.mjs';

const { values: args } = parseArgs({ options: { out: { type: 'string' }, cap: { type: 'string', default: '4' }, port: { type: 'string', default: '4396' }, 'no-build': { type: 'boolean' }, fake: { type: 'boolean' } } });
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const cap = Number(args.cap);
const port = Number(args.port);
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`;
  console.log(line);
  writeFileSync(join(out, 'director.log'), `${line}\n`, { flag: 'a' });
};
if (process.env.CLAUDECODE) throw new Error('Unset CLAUDECODE first.');

const buildWeb = (film) => {
  const env = { ...process.env };
  if (film) env.VITE_WORKLINGS_FILM = '1';
  else delete env.VITE_WORKLINGS_FILM;
  const r = spawnSync(process.execPath, [join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: REPO, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`vite build: ${r.stderr}`);
  const bundle = readFileSync(join(REPO, 'dist', 'web', 'index.html'), 'utf8');
  log(`web built ${film ? 'with' : 'without'} the film camera (${bundle.length} bytes of index.html)`);
};
if (!args['no-build']) buildWeb(true);

// ---------------------------------------------------------------------------------------------------------------------
const scratch = join(tmpdir(), `wl-film9-${Date.now()}`);
const home = join(scratch, 'home');
mkdirSync(join(home, '.worklings'), { recursive: true });
writeFileSync(join(home, '.worklings', 'settings.json'), JSON.stringify({ stakeholder: 'Robin' }));
const ROOT = 'C:\\Projects';
// An empty C:\Projects is one an earlier take of this director left behind (a stopped run); anything in it is not ours.
if (existsSync(ROOT) && readdirSync(ROOT).length > 0) throw new Error(`${ROOT} exists already and is not empty: not mine to use.`);
mkdirSync(ROOT, { recursive: true });
const JOB = {
  id: 'tidewatch',
  folder: 'C:\\Projects\\tidewatch',
  words:
    'Build tidewatch, a tiny Node CLI that prints the next high and low tides for a harbour from a JSON table. Keep a todo list and write the code first. Then start three subagents together in one message: one writes the node:test tests, one writes the README, and one adds a second harbour’s tide table with a check that it loads. Wait for all three, then run npm test. No questions needed.',
};
const CLAUDE_MD = `# Demo project

- A small project for a short screen recording. Build it in this folder and keep it small.
- Skip questions, plans for approval, reviews and device checks: decide yourself and say what you decided.
- Don't open a browser or use browser tools. Check what you built with node.
- When you use subagents, start them together in one message and wait for them; don't end your turn while they work.
- Name files by their path inside this folder. Finish with a short summary of what you built and how you checked it.
`;
{
  const dir = join(ROOT, JOB.id);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    `${JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' }, permissions: { defaultMode: 'acceptEdits', allow: ['Read', 'Glob', 'Grep', 'Bash', 'PowerShell'], ask: ['Bash(npm test*)', 'PowerShell(npm test*)'], deny: ['mcp__plugin_chrome-devtools-mcp_chrome-devtools', 'mcp__claude-in-chrome', 'mcp__computer-use'] } }, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD);
}

const env = { ...process.env, WORKLINGS_HOME: home, ANTHROPIC_MODEL: 'sonnet' };
delete env.CLAUDECODE;
delete env.WORKLINGS_CLAUDE;
delete env.WORKLINGS_SHAPE;
if (args.fake) {
  // A free dry run: the fake desk (test/fake-desk.mjs) plays the session, helpers in a config folder made here only for it.
  const script = join(scratch, 'fake-script.json');
  const steps = [
    { think: 1500 }, { say: 'Writing tidewatch.' }, { wait: 4000 },
    { helper: { type: 'general-purpose', description: 'Write node:test tests', ms: 5000 } },
    { helper: { type: 'general-purpose', description: 'Write README', ms: 5000 } },
    { helper: { type: 'general-purpose', description: 'Add Brest tide table', ms: 5000 } },
    { tool: 'Bash', input: { command: 'npm test', description: 'Run npm test' }, ask: true, ms: 2000 },
    { say: 'Built tidewatch. npm test passes: 8 tests, 0 failures.' },
  ];
  writeFileSync(script, JSON.stringify({ default: steps }));
  Object.assign(env, { WORKLINGS_CLAUDE: join(REPO, 'test', 'fake-desk.mjs'), FAKE_DESK_SCRIPT: script, FAKE_DESK_SESSIONS: join(scratch, 'sessions'), CLAUDE_CONFIG_DIR: join(scratch, 'fake-claude-config') });
}
const hubLog = join(out, 'hub.log');
const hub = spawn(process.execPath, ['src/cli.ts', 'hub', '--port', String(port), '--no-open'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
hub.stdout.on('data', (d) => writeFileSync(hubLog, d, { flag: 'a' }));
hub.stderr.on('data', (d) => writeFileSync(hubLog, d, { flag: 'a' }));
writeFileSync(join(out, 'pids.json'), JSON.stringify({ hub: hub.pid, scratch }));
log(`hub pid ${hub.pid} on ${port}`);
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  if (hub.exitCode === null && hub.pid) spawnSync('taskkill', ['/PID', String(hub.pid), '/T', '/F'], { stdio: 'ignore' });
  try {
    cpSync(ROOT, join(out, 'projects'), { recursive: true, filter: (p) => !p.includes('node_modules') });
  } catch {
    // Nothing built yet: nothing to keep.
  }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  cleanup();
  process.exit(1);
});

const base = `http://127.0.0.1:${port}`;
const tokenFile = join(home, '.worklings', 'token');
for (let i = 0; i < 100 && !existsSync(tokenFile); i++) await sleep(300);
const token = readFileSync(tokenFile, 'utf8').trim();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${base}/api/health`, { headers })).ok) break;
  } catch {
    // Not listening yet.
  }
  await sleep(300);
}
const api = async (path, body) => {
  const res = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

// ---------------------------------------------------------------------------------------------------------------------
// The stakeholder off camera: every other prompt allowed once after a few seconds; the first npm test waits for the phone.
const spendOf = (c) => c.people.reduce((s, p) => s + p.cost, 0) + (c.helpers ?? []).reduce((s, h) => s + h.costUsd, 0);
const state = { view: null, spend: 0, answered: new Set(), phoneAsk: null, stopped: false, asks: [], firstHelpers: null };
let companyId = null;
async function poll() {
  while (!state.stopped) {
    try {
      if (companyId) {
        const c = (await api(`/api/c/${encodeURIComponent(companyId)}/state`)).company;
        state.view = c;
        state.spend = spendOf(c);
        if (state.firstHelpers === null && (c.helpers ?? []).length > 0) {
          state.firstHelpers = Date.now();
          log(`helpers: ${(c.helpers ?? []).map((h) => h.description).join(' | ')}`);
        }
        for (const a of c.approvals) {
          if (a.answer || a.withdrawn || state.answered.has(a.id)) continue;
          const npm = /npm test/.test(`${a.summary} ${a.detail}`);
          state.answered.add(a.id);
          if (npm && state.phoneAsk === null) {
            state.phoneAsk = { id: a.id, at: Date.now() };
            state.asks.push({ summary: a.summary, by: 'phone' });
            log(`phone ask ${a.id}: ${a.summary.slice(0, 80)}`);
            continue;
          }
          state.asks.push({ summary: a.summary, by: 'director' });
          log(`director allows: ${a.summary.slice(0, 80)}`);
          setTimeout(() => void api(`/api/c/${encodeURIComponent(companyId)}/approvals`, { approval: a.id, decision: 'allow', always: false }).catch((e) => log(`allow failed ${e.message}`)), 400);
        }
        for (const q of c.questions) {
          if (q.answer || q.withdrawn || state.answered.has(q.id)) continue;
          const built = existsSync(join(ROOT, JOB.id, 'package.json'));
          if (q.plainTurn && built) continue;
          state.answered.add(q.id);
          log(`director answers: ${q.text.slice(0, 80)}`);
          setTimeout(() => void api(`/api/c/${encodeURIComponent(companyId)}/answers`, { question: q.id, option: null, text: 'Go ahead with your own picks.' }).catch(() => {}), 3_500);
        }
        if (state.spend > cap) {
          log(`spend $${state.spend.toFixed(2)} passed the cap: pausing`);
          await api(`/api/c/${encodeURIComponent(companyId)}/pause`, {}).catch(() => {});
          state.stopped = true;
        }
      }
    } catch (e) {
      log(`poll: ${e.message}`);
    }
    await sleep(700);
  }
}
const done = () => {
  const c = state.view;
  if (!c) return false;
  const words = c.questions.some((q) => q.plainTurn && !q.answer && !q.withdrawn);
  const helping = (c.helpers ?? []).some((h) => h.state === 'working');
  const working = c.people.some((p) => p.desk.state === 'working' || p.desk.state === 'starting');
  const open = c.approvals.some((a) => !a.answer && !a.withdrawn);
  return words && !helping && !working && !open;
};

// ---------------------------------------------------------------------------------------------------------------------
const escaped = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
const { blocklist } = await import(new URL(`file:///${join(REPO, 'scripts', 'check-public.mjs').replace(/\\/g, '/')}`).href);
const GUARD = [
  ...[userInfo().username, homedir(), homedir().replace(/\\/g, '/'), 'AppData', 'wl-film9-'].filter((s) => s && s.length > 3).map((s) => ({ label: s, test: new RegExp(String.raw`(?<!\w)${escaped(s)}(?!\w)`, 'i') })),
  ...blocklist().map((p) => ({ label: p.label, test: p.re })),
];
// A tap shows as a soft ring where the finger lands (a screencast has no pointer).
const TAPS = String.raw`(() => { addEventListener('pointerdown', (e) => {
  const d = document.createElement('div');
  d.setAttribute('aria-hidden', 'true');
  d.style.cssText = 'position:fixed;left:' + (e.clientX - 22) + 'px;top:' + (e.clientY - 22) + 'px;width:44px;height:44px;border-radius:50%;background:rgba(24,36,31,.28);border:2px solid rgba(252,251,247,.9);z-index:2147483647;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out';
  document.body.append(d);
  requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 600);
}, true); })()`;

const launch = (scale) => chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11', `--force-device-scale-factor=${scale}`] });
const deskBrowser = await launch(2);
const mk = async (vp, extra = {}) => {
  const ctx = await deskBrowser.newContext({ viewport: vp, deviceScaleFactor: 2, bypassCSP: true, ...extra });
  await ctx.addInitScript(TAPS);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`pageerror ${e.message}`));
  return page;
};
const A = await mk({ width: 960, height: 540 });
const B = await mk({ width: 540, height: 960 });
// The desktop with its HUD (the tap's answer, then the result): a page of its own.
const G = await mk({ width: 960, height: 540 });
// Zoom per page: A 0.75 of a 1280-point page's, B 0.6.
const boardBrowser = await launch(2.6667);
const C = await (async () => {
  const ctx = await boardBrowser.newContext({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2.6667, isMobile: true, hasTouch: true, bypassCSP: true });
  await ctx.addInitScript(TAPS);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`board pageerror ${e.message}`));
  return page;
})();
const go = (page, path) => page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}token=${token}`);
const film = (page, call) => page.evaluate(`window.__worklingsFilm.office.${call}`);
const marks = { start: Date.now() };
const note = (what) => {
  marks[what] = Date.now();
  log(what);
};
const recs = {};

try {
  void poll();
  const made = await api('/api/companies', { folder: JOB.folder, prompt: JOB.words, work: 'plain' });
  companyId = made.id;
  note(`started ${companyId}`);
  writeFileSync(join(out, 'pids.json'), JSON.stringify({ hub: hub.pid, scratch, company: companyId }));

  // The desk pages: the office, HUD hidden, the camera close on Claude Code's desk.
  for (const p of [A, B]) {
    await go(p, `/c/${companyId}`);
    await p.waitForFunction('window.__worklingsFilm?.office', null, { timeout: 60_000 });
  }
  let person = null;
  for (let i = 0; i < 120 && !person; i++) {
    const a = await film(A, 'anchors()');
    const key = Object.keys(a).find((k) => k.startsWith('tray:'));
    if (key) {
      person = { key, at: a[key] };
      writeFileSync(join(out, 'anchors.json'), JSON.stringify(a, null, 1));
    } else await sleep(500);
  }
  if (!person) throw new Error('No desk with a tray.');
  log(`desk ${person.key} at ${person.at.map((v) => v.toFixed(2)).join(',')}`);
  const [px, , pz] = person.at;
  // Helpers stand at +1.35 x and +1.05 z of the desk's person: frame the four of them.
  const T = [px + 0.45, 0.9, pz + 0.45];
  const wide = (k) => ({ target: T, azimuth: 30, polar: 56, zoom: 80 * k });
  const close = (k) => ({ target: [T[0] + 0.1, 0.9, T[2] + 0.1], azimuth: 38, polar: 54, zoom: 118 * k });
  for (const [p, k] of [[A, 0.75], [B, 0.6]]) {
    await p.evaluate(HIDE_HUD);
    await film(p, `set(${JSON.stringify(wide(k))})`);
  }
  // The phone and the board wait, loaded, off camera.
  await go(C, `/c/${companyId}/tasks`);
  await go(G, `/c/${companyId}`);
  const phoneBrowser = await launch(2.6667);
  const phoneCtx = await phoneBrowser.newContext({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2.6667, isMobile: true, hasTouch: true, bypassCSP: true });
  await phoneCtx.addInitScript(TAPS);
  const D = await phoneCtx.newPage();
  D.on('pageerror', (e) => log(`phone pageerror ${e.message}`));
  await go(D, `/c/${companyId}`);

  recs.A = await record(A, out, 'A-desk', { guard: GUARD });
  recs.B = await record(B, out, 'B-desk-9x16', { guard: GUARD });
  note('desk-rolling');

  // Helpers: push in on the desk as they appear; the board films their costs from then until the prompt.
  for (let i = 0; i < 600 && state.firstHelpers === null && state.phoneAsk === null && !state.stopped; i++) await sleep(250);
  note('helpers-seen');
  recs.A.mark('helpers');
  recs.B.mark('helpers');
  const push = (k) => [{ at: 0, ...wide(k) }, { at: 1, ...close(k) }];
  recs.C = await record(C, out, 'C-board', { guard: GUARD });
  await sleep(4500);
  recs.A.mark('push');
  recs.B.mark('push');
  void A.evaluate(`void window.__worklingsFilm.office.play(${JSON.stringify(push(0.75))}, 5)`);
  void B.evaluate(`void window.__worklingsFilm.office.play(${JSON.stringify(push(0.6))}, 5)`);
  // Only the npm test prompt ends this wait: a turn that ends while the helpers work looks done for a moment.
  for (let i = 0; i < 2400 && state.phoneAsk === null && !state.stopped; i++) await sleep(250);
  recs.C.mark('ask');
  // The prompt: Claude Code takes its paper to the front desk; frame the desk and the front desk together.
  if (state.phoneAsk) {
    const a = await film(A, 'anchors()');
    const front = a['desk:front'] ?? [T[0] + 7, 1, T[2] + 2.6];
    // 16:9: the front desk at the left third (the phone stands at the right); 9:16: the front desk in the middle.
    const az = 40;
    const right = [Math.cos((az * Math.PI) / 180), 0, -Math.sin((az * Math.PI) / 180)];
    const shift = (z, px) => [front[0] + right[0] * (px / z), 0.9, front[2] + right[2] * (px / z)];
    const both = (k) => (k === 0.75 ? { target: shift(75, 225), azimuth: az, polar: 55, zoom: 75 } : { target: [front[0], 0.9, front[2]], azimuth: az, polar: 55, zoom: 100 * k });
    for (const [p, k] of [[A, 0.75], [B, 0.6]]) {
      const from = await film(p, 'pose()');
      void p.evaluate(`void window.__worklingsFilm.office.play(${JSON.stringify([{ at: 0, ...from }, { at: 1, ...both(k) }])}, 2.5)`);
    }
    recs.A.mark('reframe');
    recs.B.mark('reframe');
  }
  await sleep(1500);
  await recs.C.stop();
  note('board-stopped');
  // The desktop office with its HUD, which answers the phone's tap: the card and the bar's pill.
  if (state.phoneAsk) {
    await go(G, `/c/${companyId}`);
    await G.locator('[data-inbox-card]').waitFor({ timeout: 30_000 }).catch(() => {});
    recs.G = await record(G, out, 'G-desktop', { guard: GUARD });
  }

  // The phone: the prompt on the card, Allow once, while A and B film the desk.
  if (state.phoneAsk) {
    const card = D.locator('[data-inbox-card]');
    const allow = card.getByRole('button', { name: 'Allow once' });
    await card.waitFor({ timeout: 60_000 });
    recs.D = await record(D, out, 'D-phone', { guard: GUARD });
    for (let i = 0; i < 10 && !(await allow.isVisible()); i++) {
      await sleep(900);
      const next = card.getByRole('button', { name: /^Next/ });
      if (await next.isVisible()) await next.tap();
    }
    await allow.waitFor({ timeout: 30_000 });
    recs.D.mark('allow-shown');
    recs.G?.mark('allow-shown');
    recs.A.mark('allow-shown');
    recs.B.mark('allow-shown');
    await sleep(4000);
    recs.D.mark('tap');
    recs.A.mark('tap');
    recs.B.mark('tap');
    recs.G?.mark('tap');
    await allow.tap();
    note('phone-tapped');
    await sleep(6000);
    await recs.D.stop();
    await recs.G?.stop();
  } else note('no phone ask came');

  // Done: Claude Code's last words wait, nothing works, and it stays so for 8 s.
  for (let i = 0, calm = 0; i < 900 && calm < 8 && !state.stopped; i++) {
    calm = done() ? calm + 1 : 0;
    await sleep(1000);
  }
  note(`done=${done()}`);
  recs.A.mark('done');
  recs.B.mark('done');
  await sleep(3000);
  await recs.A.stop();
  await recs.B.stop();

  // The result: the office with its card (Claude Code's last words), then the board, finished.
  await go(G, `/c/${companyId}`);
  await G.locator('[data-inbox-card]').waitFor({ timeout: 30_000 }).catch(() => {});
  await sleep(2500);
  recs.E = await record(G, out, 'E-result', { guard: GUARD });
  await sleep(7000);
  await recs.E.stop();
  await go(G, `/c/${companyId}/tasks`);
  await sleep(3000);
  recs.F = await record(G, out, 'F-board-done', { guard: GUARD });
  await sleep(5000);
  await recs.F.stop();
  await phoneBrowser.close();
} catch (e) {
  log(`ERROR ${e.stack}`);
  process.exitCode = 1;
} finally {
  state.stopped = true;
  for (const r of Object.values(recs)) await r.stop?.().catch(() => {});
  const c = state.view;
  writeFileSync(
    join(out, 'run.json'),
    JSON.stringify({ spend: state.spend, cap, asks: state.asks, marks, view: c && { spend: spendOf(c), todos: c.todos, helpers: c.helpers?.map((h) => ({ type: h.type, description: h.description, state: h.state, cost: h.costUsd })), words: c.questions.filter((q) => q.plainTurn).map((q) => q.text) } }, null, 2),
  );
  log(`spend $${state.spend.toFixed(2)}`);
  await deskBrowser.close().catch(() => {});
  await boardBrowser.close().catch(() => {});
  cleanup();
  if (!args['no-build']) buildWeb(false);
}
