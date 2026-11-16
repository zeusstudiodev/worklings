// Records Worklings v3's hero video and one short clip per main feature, from a real hub whose only fake part is
// Claude Code (test/fake-desk.mjs plays scripted people), so it runs free, offline and the same way every time.
//
//   node scripts/launch/record-video.mjs [--only hero|clips|<name>[,<name>]] [--out <folder>] [--web-dir <built web app>]
//                                        [--keep] [--cpu] [--probe <folder>]
//
// Makes, in docs/launch (or --out): hero.mp4 (H.264, no audio), hero.gif, hero-poster.png and clips/<name>.mp4, one clip
// per main feature (start-company, proposal-chart, people-at-work, talking-and-relays, inbox, dashboards, preview,
// steering). Needs Playwright's Chromium and ffmpeg on the PATH. About 4 minutes, nothing is published.
//
// How: the web app is built into a temporary folder (so a build in dist/ that someone else uses stays alone) and served
// by the real hub, started as a child of this script (this same file with --hub) with the fake desk as its Claude Code,
// a temporary home and a free port. A browser at 1440x900 drives the office as a person would (typing, gliding the
// mouse, clicking) while Chrome's screencast saves every frame; the frames become an H.264 file, and ffmpeg cuts and
// paces that into the hero and the clips. `--only hero` or `--only inbox,preview` makes just those; `--cpu` draws with
// the software renderer (slower, same picture); `--keep` leaves the temporary folder (raw video, hub log) to look at;
// `--probe <folder>` saves a PNG at every step, for tuning the script.
//
// What shows is made up: a bakery, in a folder with a plain name, and nothing from this machine. Scenario tags
// ("[fake:name]", which pick what the fake people do) are sent through the hub's API, never typed in the page, and the
// script stops with an error if a tag or this machine's user name ever shows in the page text while recording.
// The hub, its home folder and its desks live in the temporary folder and are stopped when the script ends, by the PID
// it recorded: it never kills anything by port, name or pattern.
/* global document, HTMLTextAreaElement, WheelEvent */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values: args } = parseArgs({
  options: {
    hub: { type: 'boolean' }, only: { type: 'string' }, out: { type: 'string' }, 'web-dir': { type: 'string' },
    keep: { type: 'boolean' }, cpu: { type: 'boolean' }, probe: { type: 'string' },
  },
});
const TOKEN = 'video-token-0123456789abcdefghijklmnopqrstuv';

// ---------------------------------------------------------------------------------------------------------------------
// The hub: the real one with every real part, and the fake desk for Claude Code (this file again, started with --hub)

if (args.hub) {
  const need = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set.`);
    return value;
  };
  const { loadLibrary } = await import(new URL('../../src/composer/library.ts', import.meta.url).href);
  const { startHub } = await import(new URL('../../src/hub/index.ts', import.meta.url).href);
  const scratch = need('VIDEO_SCRATCH');
  const claudeHome = join(scratch, 'claude-home');
  for (const dir of [join(claudeHome, 'projects'), join(scratch, 'desk-scratch'), join(scratch, 'aside')]) mkdirSync(dir, { recursive: true });
  // The companies' git commits need an identity; a made-up one keeps this machine's out of it.
  const gitconfig = join(scratch, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Worklings Demo\n\temail = demo@example.com\n[init]\n\tdefaultBranch = main\n');
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome };
  delete env.CLAUDECODE;
  const hub = await startHub({
    port: Number(need('VIDEO_PORT')), token: TOKEN, webDir: need('VIDEO_WEB'), library: loadLibrary(), home: need('WORKLINGS_HOME'),
    claude: need('WORKLINGS_CLAUDE'), env, claudeHome, tickMs: 50,
    desks: { scratch: join(scratch, 'desk-scratch') }, aside: { env: { ...env }, workRoot: join(scratch, 'aside') },
  });
  console.log(`video hub on ${hub.url}`);
  const stop = () => void hub.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// ---------------------------------------------------------------------------------------------------------------------
// The made-up company: a corner bakery. What each fake person does is named by a scenario (test/fake-desk.mjs).

const member = (id, name, title, level, room, reportsTo, model, owns, library) => ({ id, name, title, level, room, reportsTo, model, owns, library });
const PROPOSAL = {
  company: 'Corner Bakery',
  goal: 'A website for the corner bakery, with pickup orders.',
  size: 'large',
  sizing: 'A site with a design side and an engineering side, each with its own head and the people who do the work.',
  theme: 'cafe',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'design', title: 'Design', style: 'design' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  people: [
    member('ceo', 'Noor', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the line to the stakeholder', 'ceo'),
    member('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', 'sonnet', 'The look and the flows of the site', 'head'),
    member('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The pickup order flow', 'ux-designer'),
    member('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The palette, type and the menu cards', 'ui-designer'),
    member('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo', 'sonnet', 'The site, its data and its releases', 'head'),
    member('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'The pages and the order form', 'frontend-engineer'),
    member('backend-engineer', 'Ivo', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'Orders and pickup slots', 'backend-engineer'),
    member('qa-engineer', 'Tom', 'QA engineer', 'worker', 'engineering', 'head-of-engineering', 'haiku', 'Testing the site on phones', 'qa-engineer'),
  ],
  questions: [],
};

const PLAN = {
  goal: 'Ship the menu and pickup orders.',
  milestones: [
    { id: 'ms-1', title: 'The menu page', doneWhen: 'Customers can see the menu and the prices.' },
    { id: 'ms-2', title: 'Pickup orders', doneWhen: 'A customer can order and choose a pickup time.' },
  ],
  tasks: [
    { id: 'p-1', title: 'Sketch the pickup flow', owner: 'ux-designer', files: ['design/pickup.md'], milestone: 'ms-1', after: [], brief: 'Three screens: pick, time, confirm.', doneWhen: 'The three screens are described.' },
    { id: 'p-2', title: 'Build the menu page', owner: 'frontend-engineer', files: ['src/menu/'], milestone: 'ms-1', after: ['p-1'], brief: 'Cards with a photo, a name and a price.', doneWhen: 'The page renders with the real menu.' },
    { id: 'p-3', title: 'Open the pickup slots', owner: 'backend-engineer', files: ['src/orders/'], milestone: 'ms-2', after: [], brief: 'Slots every fifteen minutes, with a limit.', doneWhen: 'A slot can be booked and is then full.' },
  ],
};

/** What each person is doing while they work, for the Now panel and the desks. */
const WORK = {
  'head-of-engineering': 'Planning the site and the order data.',
  'ux-designer': 'Sketching the pickup flow: choose, pick a time, collect.',
  'frontend-engineer': 'Building the menu page.',
  'backend-engineer': 'Opening the pickup slots.',
  'qa-engineer': 'Writing phone tests for the order form.',
};
const workScenarios = Object.fromEntries(Object.entries(WORK).map(([id, text]) => [`work-${id}`, [{ org: 'post_status', arguments: { text } }, { wait: 240_000 }, { say: 'Done.' }]]));

/** The CEO's scoping questions for the one short sentence typed in the start form (asked before it drafts anything). */
const SCOPING = [
  { text: 'Who is it for?', options: ['Just our own customers', 'Anyone in the neighbourhood'], recommended: 0, why: 'A corner bakery sells to the people who walk past.' },
  { text: 'How far should the first version go?', options: ['A simple menu page', 'Menu, pickup orders and a payment'], recommended: 1, why: 'Pickup orders are the point, and they fit in a first release.' },
  { text: 'Where should it run?', options: ['On phones first', 'On desktop first'], recommended: 0, why: 'Most orders will come from a phone on the way to work.' },
  { text: 'What matters most?', options: ['Ordering in under a minute', 'Showing off the bread'], recommended: 0, why: 'A quick order is what brings people back.' },
];

const SCENARIOS = {
  // A short prompt: the questions first, the draft once the answers arrive in one message (the `found-scoped` rule below).
  scope: [{ org: 'ask_scoping', arguments: { questions: SCOPING } }, { say: 'I asked four questions before drafting.' }],
  'found-scoped': [
    { org: 'post_status', arguments: { text: 'Sketching the org on the whiteboard.' } },
    { org: 'library_catalogue', arguments: {} },
    // Long enough for the CEO to walk in and draw boxes on the office's board for a few seconds before the proposal.
    { wait: 9_000 },
    { org: 'propose_org', arguments: PROPOSAL },
    { say: 'I proposed an org of eight for Corner Bakery.' },
  ],
  found: [
    { org: 'post_status', arguments: { text: 'Sketching the org on the whiteboard.' } },
    { org: 'library_catalogue', arguments: {} },
    // Long enough for the CEO to walk in and draw boxes on the office's board for a few seconds before the proposal.
    { wait: 9_000 },
    { org: 'propose_org', arguments: PROPOSAL },
    { say: 'I proposed an org of eight for Corner Bakery.' },
  ],
  ...workScenarios,
  push: [{ tool: 'Bash', input: { command: 'git push origin HEAD', description: 'Push the menu branch' }, ask: true }, { say: 'Pushed the branch.' }],
  // The CEO passes a note to the head of design: someone from another room walks over.
  relay: [{ org: 'relay', arguments: { to: ['head-of-design'], note: 'Start on the warmer menu colours, please.' } }, { say: 'Passed it on to Ada.' }],
  ask: [{ org: 'ask_stakeholder', arguments: { question: 'Which payment should the site take?', options: ['TWINT', 'Card'], recommended: 0 } }, { say: 'Asked.' }],
  goal: [
    { org: 'set_goal', arguments: { goal: 'Ship the menu and pickup orders.', milestones: PLAN.milestones.map(({ title, doneWhen }) => ({ title, doneWhen })) } },
    { say: 'Goal set.' },
  ],
  'assign-m1': [
    { org: 'assign', arguments: { to: 'ux-designer', title: 'Sketch the pickup flow', brief: 'Three screens: choose, pick a time, collect.', files: [], doneWhen: 'The three screens are described.', milestone: 'ms-1' } },
    { say: 'Assigned.' },
  ],
  'report-done': [{ org: 'report', arguments: { outcome: 'done', summary: 'Three screens described: choose, pick a time, collect.', task: 't-1' } }, { say: 'Reported.' }],
  accept: [{ org: 'review', arguments: { task: 't-1', verdict: 'accept', note: 'Clear, thank you.' } }, { say: 'Accepted.' }],
  dashboard: [
    {
      org: 'publish_dashboard',
      arguments: {
        title: 'Launch checklist',
        widgets: [
          { kind: 'stat', title: 'Pages designed', value: 7, unit: 'of 9', note: 'The menu page is done.' },
          { kind: 'progress', title: 'Pickup orders', value: 3, max: 8 },
          { kind: 'bars', title: 'Open bugs by page', bars: [{ label: 'Menu', value: 4 }, { label: 'Order form', value: 2 }, { label: 'Slots', value: 1 }] },
        ],
      },
    },
    { say: 'Published the launch checklist.' },
  ],
  plan: [{ org: 'propose_plan', arguments: { ...PLAN, note: 'First plan: the menu first, then pickup orders.' } }, { say: 'I proposed a plan.' }],
  // An untagged message (one typed in the page, a relay's note, a task handed out) plays this: short work, then done.
  // A usage limit: the company rests, and the office goes to sleep (it ends the hub's work, so it is recorded last).
  limit: [{ limit: { status: 'rejected', resetsAt: Math.ceil(Date.now() / 1000) + 2 * 3600, rateLimitType: 'five_hour', utilization: 1 } }, { fail: 'usage-limit' }],
  'default-turn': [{ org: 'post_status', arguments: { text: 'On it.' } }, { wait: 3_500 }, { say: 'Done.' }],
};

/**
 * Turns nobody can tag: the office's own words to a desk. The start turn of a company whose plan waits for approval makes
 * the CEO propose the plan; the answers to the scoping questions make it draft; a task handed out (its title is in the
 * turn) makes its owner work for a long while, with a line of what they are doing.
 */
const BY_TEXT = [
  { includes: 'First propose the plan with propose_plan', scenario: 'plan' },
  { includes: 'Answers to your scoping questions', scenario: 'found-scoped' },
  { includes: 'Three screens: pick, time, confirm.', scenario: 'work-ux-designer' },
  { includes: 'Build the menu page', scenario: 'work-frontend-engineer' },
  { includes: 'Open the pickup slots', scenario: 'work-backend-engineer' },
];

/** The script the fake desk reads. `first` is what the first untagged turn of each desk plays (the CEO's opening turn). */
const scriptOf = (options = {}) => ({
  scenarios: SCENARIOS,
  byText: BY_TEXT,
  default: options.default ?? SCENARIOS['default-turn'],
  ...(options.first ? { turns: [options.first] } : {}),
});

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const auth = { authorization: `Bearer ${TOKEN}`, connection: 'close' };

async function freePort() {
  return await new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}

async function until(check, timeoutMs, message) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(120);
  }
  throw new Error(`Timed out: ${message}`);
}

/** Stops a process this script started and its children (the hub's desks), by its recorded PID. */
function stopTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function ffmpeg(argv, label) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`ffmpeg failed (${label}):\n${run.stderr}`);
}

/** A file's length in seconds, from ffmpeg's own header line (there is no ffprobe here). */
function lengthOf(file) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(run.stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

const kb = (file) => `${(statSync(file).size / 1024 / (statSync(file).size > 1 << 20 ? 1024 : 1)).toFixed(statSync(file).size > 1 << 20 ? 2 : 0)} ${statSync(file).size > 1 << 20 ? 'MB' : 'kB'}`;

// Page code for the video: a cursor (a screencast has none, and a click without one is hard to follow), and the cutting
// of scenario tags from the page's text.
const INIT = String.raw`(() => {
  const add = () => {
    if (document.getElementById('__cursor') || !document.body) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8.2-6.1 1.5 3.4 6.3-2.6 1.4-3.4-6.3L3.8 17.6z" fill="#18241f" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    addEventListener('mousemove', (e) => { c.style.opacity = '1'; c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
  // The scenario tags the script puts at the end of its messages are test plumbing, not product: they are cut from the
  // page's text before it is drawn (a mutation observer runs before the next paint). The 3D labels are left alone: they
  // change every frame and only show the start of a message, where no tag is.
  const TAG = /\s*\[fake:[\w-]+\]/g;
  const clean = (node) => {
    if (node.nodeType === 3) {
      if (node.data.includes('[fake:')) node.data = node.data.replace(TAG, '');
    } else if (node.nodeType === 1 && node.textContent.includes('[fake:')) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) clean(n);
    }
  };
  const skipped = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.labels, canvas, #__cursor');
  if (!window.__noRedact) {
    new MutationObserver((records) => {
      for (const r of records) {
        if (skipped(r.target)) continue;
        if (r.type === 'characterData') clean(r.target);
        else for (const added of r.addedNodes) clean(added);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }
})()`;

/** What must never show in a video: a scenario tag, or anything of this machine's user. */
const escaped = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
/** Patterns, not substrings: a user name as short as "matte" is inside ordinary words ("matters"), so it matches as a whole word. */
const FORBIDDEN = [
  { label: '[fake:', test: /\[fake:/i },
  { label: 'fake:', test: /fake:/i },
  ...[userInfo().username, homedir()].filter((s) => s && s.length > 3).map((s) => ({ label: s, test: new RegExp(String.raw`(?<!\w)${escaped(s)}(?!\w)`, 'i') })),
];

/**
 * A recording of one page: Chrome's screencast saves every frame it draws, with its time, and stop() turns them into
 * an H.264 file at 30 frames a second. mark(name) notes the moment (in seconds from the first frame) for the cuts.
 */
async function startRecording(world, page, name) {
  const dir = join(world.raw, name);
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let t0 = null;
  const writes = [];
  let stopped = false;
  cdp.on('Page.screencastFrame', (f) => {
    if (stopped) return;
    const at = f.metadata.timestamp;
    t0 ??= at;
    const file = `${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ file, at });
    writes.push(writeFile(join(dir, file), Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  await until(() => t0 !== null, 10_000, `no frame of ${name}`);
  const marks = {};
  const leaks = [];
  const guard = setInterval(async () => {
    try {
      const text = await page.evaluate('document.body.innerText');
      for (const bad of FORBIDDEN) {
        const found = bad.test.exec(text);
        if (found) leaks.push(`${name} at ${now().toFixed(1)} s: "${bad.label}" showed on screen: ...${text.slice(Math.max(0, found.index - 40), found.index + 50).replace(/\s+/g, ' ')}...`);
      }
    } catch {
      // The page is mid-navigation; the next tick looks again.
    }
  }, 300);
  const now = () => Date.now() / 1000 - t0;
  return {
    marks,
    mark(label) {
      marks[label] = now();
      world.log(`  mark ${label} @ ${marks[label].toFixed(1)} s`);
    },
    async stop() {
      clearInterval(guard);
      const end = Date.now() / 1000;
      stopped = true;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
      if (leaks.length > 0) throw new Error([...new Set(leaks)].join('\n'));
      const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, ((frames[i + 1]?.at ?? end) - f.at)).toFixed(4)}`).join('\n');
      writeFileSync(join(dir, 'frames.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
      const file = join(world.raw, `${name}.mp4`);
      ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-an', file], `raw ${name}`);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      world.log(`  raw ${name}: ${lengthOf(file).toFixed(1)} s, ${frames.length} frames`);
      return { file, marks };
    },
  };
}

/** A fresh browser context, page and recording of the office. */
async function openPage(world, name, path) {
  const context = await world.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await context.addInitScript(process.env.NO_REDACT ? `window.__noRedact = true;${INIT}` : INIT);
  const page = await context.newPage();
  page.on('pageerror', (e) => world.errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) world.errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`${world.HUB}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`);
  return { context, page };
}

/** Waits until the 3D scene is drawing: its labels are placed over it. */
const sceneReady = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.labels .label')].some((l) => /office/i.test(l.textContent ?? '') && l.getBoundingClientRect().width > 0), null, { timeout: 30_000 });
/**
 * What the scene has worked out for this moment (poses, walks, celebration, board boxes), read from the page's React
 * state: the people are small 3D figures, and a condition on what they do is better read than guessed from pixels.
 * This leans on the office's internals, so it only waits: a script that finds nothing carries on after its time.
 */
const castOf = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.labels');
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    const test = (v) => v && typeof v === 'object' && v.moments && v.members;
    let fiber = key ? el[key] : null;
    while (fiber) {
      let hook = fiber.memoizedState;
      for (let n = 0; hook && typeof hook === 'object' && n < 60; n++, hook = hook.next) {
        const v = hook.memoizedState;
        const found = test(v) ? v : Array.isArray(v) && test(v[0]) ? v[0] : null;
        if (found) {
          return {
            celebration: found.moments.celebration,
            boxes: found.props?.boxes?.length ?? 0,
            members: found.members.map((m) => ({ person: m.person, pose: m.body.pose, x: m.x, z: m.z, walking: Array.isArray(m.walk) && m.walk.length > 0, keys: Object.keys(m).join(',') })),
          };
        }
      }
      fiber = fiber.return;
    }
    return null;
  });
/** Waits for a condition on the scene's cast; false when the time ran out (or the cast could not be read). */
async function sceneWait(page, test, timeoutMs, everyMs = 80) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const cast = await castOf(page).catch(() => null);
    if (cast && test(cast)) return true;
    await sleep(everyMs);
  }
  return false;
}
/** The number of people the scene is walking right now. */
const walking = (page) => page.evaluate(() => document.querySelectorAll('.labels .label[data-walking="true"]').length);
/** Waits until someone has been seen walking and then nobody is, or the time is up. */
async function walkDone(page, seenWithin = 8_000, doneWithin = 25_000) {
  const startAt = Date.now();
  let seen = false;
  while (Date.now() - startAt < doneWithin) {
    const n = await walking(page);
    if (n > 0) seen = true;
    else if (seen) return true;
    else if (Date.now() - startAt > seenWithin) return false;
    await sleep(150);
  }
  return false;
}

/** Moves the mouse to an element in a glide, then clicks it. */
async function glideClick(page, locator, { settle = 120 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Nothing to click.');
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 24, { steps: 3 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await sleep(settle);
  await locator.click();
}

async function glideTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Nothing to point at.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
}

async function typeLike(page, locator, text, delay = 34) {
  await glideClick(page, locator);
  await page.keyboard.type(text, { delay });
}

/** The hub's HTTP API, as the browser uses it. */
function makeApi(HUB) {
  const call = async (path, body) => {
    const res = await fetch(`${HUB}/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const view = async (id) => (await call(`api/c/${id}/state`)).body.company;
  return {
    call,
    view,
    async say(id, to, text) {
      const sent = await call(`api/c/${id}/messages`, { to, text });
      if (sent.status !== 202) throw new Error(`Saying to ${to} gave ${sent.status}.`);
    },
    /** Founds a company in a folder with a plain name; the CEO starts drafting. */
    async found(world, name, prompt) {
      const folder = join(world.projects, name);
      mkdirSync(folder, { recursive: true });
      const created = await call('api/companies', { folder, prompt });
      if (created.status !== 201) throw new Error(`Creating ${name} gave ${created.status}: ${JSON.stringify(created.body)}`);
      return { id: created.body.id, folder };
    },
    /** Waits for the turn a person was just given (a task handed out starts one) to start and end. */
    async settle(id, person) {
      const state = async () => (await view(id)).people.find((p) => p.id === person).desk.state;
      await until(async () => (await state()) === 'working', 15_000, `${person} to start`).catch(() => {});
      await until(async () => (await state()) !== 'working', 30_000, `${person} to finish`);
    },
    async waitFor(id, label, pick, timeout = 60_000) {
      let last;
      await until(async () => ((last = await view(id)), Boolean(pick(last))), timeout, label).catch((e) => {
        throw new Error(`${e.message} (approvals ${JSON.stringify(last?.approvals?.map((a) => a.answer))}, questions ${JSON.stringify(last?.questions?.map((q) => q.answer))}, desks ${JSON.stringify(last?.people?.map((p) => p.desk.state))})`);
      });
      return last;
    },
    /** Founds a company by API with the CEO's draft, then starts it: a running company of eight. */
    async running(world, name) {
      world.setScript(scriptOf({ first: 'found' }));
      const { id, folder } = await this.found(world, name, 'A website for our corner bakery, with pickup orders');
      await this.waitFor(id, `${name} proposed`, (c) => c.phase === 'proposed');
      world.setScript(scriptOf());
      // A new company waits for the plan's approval before anyone gets work; the clips that hand work out by message skip it.
      const set = await call(`api/c/${id}/settings`, { planApproval: 'off' });
      if (set.status !== 200) throw new Error(`Settings gave ${set.status}.`);
      const started = await call(`api/c/${id}/start`, {});
      if (started.status !== 200) throw new Error(`Starting ${name} gave ${started.status}.`);
      await this.waitFor(id, `${name} running`, (c) => c.phase === 'running');
      return { id, folder };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The hero

/**
 * Cuts recordings into pieces ([source, from, to, speed, crop]: speed 2 plays twice as fast; crop is "w:h:x:y" in the
 * source's own pixels, blown up to the full frame), joins them and encodes the result at 1440x900.
 */
function cutTo(pieces, file) {
  const sources = [...new Set(pieces.map((p) => p[0]))];
  const parts = pieces.map(([src, from, to, speed = 1, crop = null], i) => `[${sources.indexOf(src)}:v]trim=start=${from.toFixed(3)}:end=${to.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}${crop ? `,crop=${crop}` : ''},scale=1440:900:flags=lanczos,setsar=1[v${i}]`);
  const joined = pieces.map((_, i) => `[v${i}]`).join('');
  ffmpeg(
    [...sources.flatMap((src) => ['-i', src]), '-filter_complex', `${parts.join(';')};${joined}concat=n=${pieces.length}:v=1:a=0,fps=30,format=yuv420p[out]`, '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', '-an', file],
    `cut ${file}`,
  );
}

/** The stage and dock's own pieces, found by role and name as the e2e kit finds them (test/e2e/v3-kit.ts). */
const sidePanel = (page) => page.getByRole('complementary', { name: 'Side panel' });
const switcher = (page) => page.getByRole('navigation', { name: 'Views' });
const talkBar = (page) => page.getByRole('form', { name: 'Talk bar' });
const boardFrame = (page, title) => page.getByRole('region', { name: title, exact: true });

/** Goes to a main view through its link in the company bar, as a person does. */
async function goTo(page, view) {
  await glideClick(page, switcher(page).getByRole('link', { name: view, exact: true }));
}

/** Back from a board to the office: the board's own key. */
async function backToOffice(page, title) {
  await glideClick(page, boardFrame(page, title).getByRole('button', { name: 'Back to the office', exact: true }));
}

/**
 * Sends what is in the talk bar with a scenario tag added in one step, as Send is pressed, so no frame of the page ever
 * shows the tag (the tag is test plumbing: it picks what the fake person does).
 */
async function sendTagged(page, tag) {
  await talkBar(page)
    .getByRole('button', { name: 'Send', exact: true })
    .evaluate(
      (button, tagText) => {
        const field = document.querySelector('form[aria-label="Talk bar"] textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, `${field.value} ${tagText}`);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        button.click();
      },
      tag,
    );
}

/**
 * The start of a company as a person meets it: one sentence, the CEO's scoping questions, "Use the CEO's picks", the
 * draft on the office's whiteboard and the proposal with its sizing. Marks the moments it passes. Leaves the proposal open.
 */
async function startAndScope(world, page, rec, { folder, sentence }) {
  const { log } = world;
  const field = page.getByRole('textbox', { name: 'What should the company build?' });
  await page.getByRole('textbox', { name: 'Folder' }).fill(folder);
  rec.mark('form');
  await typeLike(page, field, sentence);
  await sleep(500);
  rec.mark('typed');
  await glideClick(page, page.getByRole('button', { name: 'Start the company' }));
  rec.mark('submitted');
  await page.waitForURL(/\/c\/[^/]+(\/proposal)?(\?.*)?$/);
  // A short sentence: the CEO asks before it drafts, and the panel shows the questions first.
  const questions = page.getByRole('region', { name: "The CEO's questions" });
  await questions.waitFor({ timeout: 60_000 });
  await sceneReady(page);
  await sleep(1500);
  rec.mark('scoping');
  await glideTo(page, questions.getByRole('button', { name: /^Anyone in the neighbourhood/ }));
  await sleep(500);
  await glideClick(page, page.getByRole('button', { name: "Use the CEO's picks", exact: true }));
  rec.mark('picks');
  await page.getByRole('heading', { name: 'Drafting your company' }).waitFor({ timeout: 30_000 });
  // The CEO walks in, then stands at the office's board and draws boxes on it: that is the shot.
  if (!(await sceneWait(page, (c) => c.boxes > 0, 25_000))) log('  warning: the CEO never drew on the board');
  rec.mark('board');
  await page.getByRole('heading', { name: "The CEO's proposal" }).waitFor({ timeout: 60_000 });
  rec.mark('proposal');
  await sleep(1500);
}

async function hero(world) {
  const { api, log, probe } = world;
  world.setScript(scriptOf({ first: 'scope' }));
  const { context, page } = await openPage(world, 'hero', '/new');
  const shot = async (n) => probe && (await page.screenshot({ path: join(probe, `hero-${n}.png`) }));
  await page.getByRole('textbox', { name: 'What should the company build?' }).waitFor();
  mkdirSync(join(world.projects, 'bakery'), { recursive: true });
  const rec = await startRecording(world, page, 'hero');
  let failure = null;
  try {
    await sleep(500);
    await startAndScope(world, page, rec, { folder: join(world.projects, 'bakery'), sentence: 'A website for our corner bakery, with pickup orders' });
    await shot('proposal');
    // The summary says why the company has this size; the chart is one press away.
    const summary = page.getByRole('region', { name: 'Summary' });
    await summary.getByRole('button', { name: 'See the chart' }).waitFor();
    await glideClick(page, summary.getByRole('button', { name: 'See the chart' }));
    await boardFrame(page, 'Org chart').getByRole('treeitem').first().waitFor();
    await sleep(1400);
    rec.mark('chart');
    await shot('chart');
    await backToOffice(page, 'Org chart');
    await sleep(300);
    await glideClick(page, page.getByRole('button', { name: 'Start the company' }).first());
    rec.mark('started');
    await switcher(page).waitFor({ timeout: 60_000 });
    const id = new URL(page.url()).pathname.split('/')[2];

    // The plan waits for the stakeholder: it is in the inbox, and approving it hands the first tasks out.
    await glideClick(page, page.getByRole('link', { name: 'Open the plan', exact: true }).first());
    const approve = boardFrame(page, 'Tasks').getByRole('button', { name: 'Approve the plan', exact: true });
    await approve.waitFor({ timeout: 60_000 });
    await sleep(1600);
    rec.mark('plan');
    await shot('plan');
    await glideClick(page, approve);
    await sleep(900);
    rec.mark('approved');
    await backToOffice(page, 'Tasks');
    await walkDone(page, 8_000, 25_000);
    rec.mark('walked-in');
    await shot('walked-in');

    // Work: the owners of the first tasks sit down; two more are given work by message (a desk busy with a long turn
    // would hold a message back, so the push and the relay below go to people who are free).
    for (const person of ['frontend-engineer', 'qa-engineer']) await api.say(id, person, `Please start on your task [fake:work-${person}]`);
    await api.waitFor(id, 'four at work', (c) => c.people.filter((p) => p.desk.state === 'working').length >= 4, 90_000);
    await sleep(2600);
    rec.mark('working');
    await shot('working');

    // An approval: Ben wants to push; it lands in the inbox, and the stakeholder answers it there.
    await api.say(id, 'head-of-engineering', 'Push the menu branch [fake:push]');
    const allow = sidePanel(page).getByRole('button', { name: 'Allow once' });
    await allow.waitFor({ timeout: 30_000 });
    await sleep(1200);
    rec.mark('inbox');
    await shot('inbox');
    await glideClick(page, allow);
    await sleep(900);
    rec.mark('allowed');
    await shot('allowed');

    // A relay, said through the talk bar: the CEO passes the note to Ada, and walks over to say it.
    await typeLike(page, talkBar(page).locator('textarea'), 'Ask Ada to start on the warmer menu colours');
    await sleep(300);
    await glideTo(page, talkBar(page).getByRole('button', { name: 'Send', exact: true }));
    await sendTagged(page, '[fake:relay]');
    rec.mark('sent');
    const walked = await walkDone(page, 40_000, 40_000);
    rec.mark('relayed');
    await shot('relayed');
    if (!walked) log('  warning: nobody was seen walking for the relay');
  } catch (e) {
    failure = e;
    await shot('fail').catch(() => {});
  }
  // A step that failed already says why; a clean run still fails here when the guard saw something it must not.
  let stopError = null;
  try {
    world.hero = await rec.stop();
  } catch (e) {
    stopError = e;
  }
  await context.close();
  if (failure ?? stopError) throw failure ?? stopError;
  return world.hero;
}

/** How far the milestone clip zooms the office's camera: the spread of its room labels it waits for. */
const ZOOM_FACTOR = 1.25;

/** The hero's cuts, from the marks of its recording, the milestone's and the night's. Times in seconds of the raw videos. */
function heroPieces(hero, milestone, night) {
  const m = hero.marks;
  const ms = milestone.marks;
  const n = night.marks;
  const h = hero.file;
  const at = (name, plus = 0) => m[name] + plus;
  return [
    [h, at('form', 0.2), at('typed', 0.4), 1.5], // one sentence typed
    [h, at('typed', 0.4), at('scoping', 0.8), 1.6], // Start pressed, the CEO's questions come up
    [h, at('scoping', 0.8), at('picks', 0.5), 1.5], // "Use the CEO's picks"
    [h, at('picks', 0.5), at('proposal', -0.2), 3.2], // the CEO drafts the org on the whiteboard
    [h, at('proposal', 0.3), at('chart', 0.2), 1.8], // the proposal, its sizing and its chart
    [h, at('started', 0.3), at('plan', 0.6), 3.2], // Start, and the plan waits in the inbox
    [h, at('plan', 0.6), at('approved', 0.8), 1.5], // the plan approved
    [h, at('approved', 0.8), at('working', 0.3), 3.2], // people walk in, sit and work
    [h, at('inbox', 0), at('allowed', 0.6), 1.8], // an approval answered
    [h, at('allowed', 0.6), at('relayed', 0), 2.6], // a relay said through the talk bar, and its walk-over
    [milestone.file, ms.celebrating - 0.5, ms.celebrated + 0.3, 1], // a milestone celebration, close up
    [night.file, n.before + 0.4, n.night + 2.4, 1], // night
  ];
}

/** Night: a usage limit puts the company to rest and the office to sleep. It stops every company of the hub, so it is recorded last. */
async function night(world) {
  const { api } = world;
  const { id } = await api.running(world, 'bakery-night');
  const busy = ['head-of-engineering', 'frontend-engineer', 'qa-engineer'];
  for (const person of busy) await api.say(id, person, `Please start on your task [fake:work-${person}]`);
  await api.waitFor(id, 'three at work', (c) => c.people.filter((p) => p.desk.state === 'working').length >= busy.length);
  const { context, page } = await openPage(world, 'night', `/c/${id}`);
  await sceneReady(page);
  const rec = await startRecording(world, page, 'night');
  try {
    await walkDone(page, 3_000, 15_000);
    await sleep(1200);
    rec.mark('before');
    await api.say(id, 'backend-engineer', 'Pick up the order slots [fake:limit]');
    await page.getByRole('banner').getByText(/Resting/).first().waitFor({ timeout: 40_000 });
    rec.mark('night');
    await sleep(5200);
    if (world.probe) await page.screenshot({ path: join(world.probe, 'night.png') });
    rec.mark('night-end');
  } finally {
    world.night = await rec.stop();
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The clips

const CLIPS = {
  // Typing the sentence and starting: the CEO asks its questions first, takes the answers and drafts.
  async 'start-company'(world) {
    world.setScript(scriptOf({ first: 'scope' }));
    const folder = join(world.projects, 'bakery-start');
    mkdirSync(folder, { recursive: true });
    const { context, page } = await openPage(world, 'start-company', '/new');
    await page.getByRole('textbox', { name: 'What should the company build?' }).waitFor();
    const rec = await startRecording(world, page, 'start-company');
    try {
      await sleep(600);
      await startAndScope(world, page, rec, { folder, sentence: 'A website for our corner bakery, with pickup orders' });
      if (world.probe) await page.screenshot({ path: join(world.probe, 'start-company.png') });
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    const { form, typed, picks, board, proposal, to } = world.last.marks;
    // The typing and the questions at a walk, the drafting wait (the CEO at the whiteboard) quickly, the proposal at rest.
    return [[form + 0.2, typed + 0.4, 1.4], [typed + 0.4, picks + 0.5, 1.2], [picks + 0.5, board + 1.5, 2.2], [board + 1.5, proposal - 0.2, 3], [proposal - 0.2, to, 1]];
  },

  // The proposal and its chart.
  async 'proposal-chart'(world) {
    const { api } = world;
    world.setScript(scriptOf({ first: 'found' }));
    const { id } = await api.found(world, 'bakery-chart', 'A website for our corner bakery, with pickup orders');
    await api.waitFor(id, 'proposed', (c) => c.phase === 'proposed');
    const { context, page } = await openPage(world, 'proposal-chart', `/c/${id}`);
    const summary = page.getByRole('region', { name: 'Summary' });
    await summary.waitFor({ timeout: 30_000 });
    await sceneReady(page);
    const rec = await startRecording(world, page, 'proposal-chart');
    try {
      await sleep(1800);
      rec.mark('from');
      await glideClick(page, summary.getByRole('button', { name: 'See the chart' }));
      const chart = boardFrame(page, 'Org chart');
      await chart.getByRole('treeitem').first().waitFor();
      await sleep(1100);
      await glideTo(page, chart.getByRole('treeitem', { name: /^Kai,/ }));
      await sleep(700);
      await glideTo(page, chart.getByRole('treeitem', { name: /^Tom,/ }));
      await sleep(1100);
      await backToOffice(page, 'Org chart');
      await sleep(1100);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    return [[world.last.marks.from, world.last.marks.to, 1]];
  },

  // People at work: the office with five people sitting at their desks, then the org chart with what each is doing and a
  // person's panel beside it.
  async 'people-at-work'(world) {
    const { api } = world;
    const { id } = await api.running(world, 'bakery-work');
    const { context, page } = await openPage(world, 'people-at-work', `/c/${id}`);
    await sceneReady(page);
    const rec = await startRecording(world, page, 'people-at-work');
    try {
      await walkDone(page, 4_000, 20_000);
      for (const person of Object.keys(WORK)) await api.say(id, person, `Please start on your task [fake:work-${person}]`);
      rec.mark('from');
      await api.waitFor(id, 'five at work', (c) => c.people.filter((p) => p.desk.state === 'working').length >= 5);
      await sleep(3000);
      await goTo(page, 'Org');
      const chart = boardFrame(page, 'Org chart');
      await chart.getByRole('treeitem', { name: /^Sam,/ }).waitFor({ timeout: 30_000 });
      await sleep(1800);
      await glideClick(page, chart.getByRole('treeitem', { name: /^Sam,/ }));
      await sidePanel(page).getByRole('button', { name: 'Message Sam' }).waitFor({ timeout: 15_000 });
      await sleep(2600);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    return [[world.last.marks.from, world.last.marks.to, 1.15]];
  },

  // Talking and relays: a message to the CEO through the talk bar, who passes it on to the head of design, and someone
  // walks over to say it.
  async 'talking-and-relays'(world) {
    const { api } = world;
    const { id } = await api.running(world, 'bakery-talk');
    const { context, page } = await openPage(world, 'talking-and-relays', `/c/${id}`);
    await sceneReady(page);
    const box = talkBar(page).locator('textarea');
    await box.waitFor();
    const rec = await startRecording(world, page, 'talking-and-relays');
    try {
      await sleep(900);
      rec.mark('from');
      await typeLike(page, box, 'Ask Ada to start on the warmer menu colours');
      await sleep(400);
      await glideTo(page, talkBar(page).getByRole('button', { name: 'Send', exact: true }));
      await sendTagged(page, '[fake:relay]');
      await walkDone(page, 20_000, 30_000);
      await sleep(900);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    const { from, to } = world.last.marks;
    return [[from, to, Math.max(1, (to - from) / 9.5)]];
  },

  // The inbox, in the side panel: a question and an approval, both answered with one press.
  async inbox(world) {
    const { api } = world;
    const { id } = await api.running(world, 'bakery-inbox');
    await api.say(id, 'backend-engineer', 'Push the menu branch [fake:push]');
    await api.say(id, 'ceo', 'Find out which payment the site should take [fake:ask]');
    await api.waitFor(id, 'two waiting', (c) => c.approvals.some((a) => a.answer == null) && c.questions.some((q) => q.answer == null));
    const { context, page } = await openPage(world, 'inbox', `/c/${id}`);
    await sceneReady(page);
    const needs = sidePanel(page);
    await needs.getByRole('button', { name: 'Allow once' }).waitFor({ timeout: 30_000 });
    const rec = await startRecording(world, page, 'inbox');
    try {
      await sleep(2000);
      rec.mark('from');
      await glideClick(page, needs.getByRole('button', { name: 'Allow once' }));
      await sleep(1900);
      await glideClick(page, needs.getByRole('button', { name: /^TWINT/ }));
      await sleep(2800);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    return [[world.last.marks.from, world.last.marks.to, 1]];
  },

  // The dashboards the office draws from what happened, and the one the CEO publishes.
  async dashboards(world) {
    const { api } = world;
    const { id } = await api.running(world, 'bakery-boards');
    await api.say(id, 'ceo', 'Set the goal for the bakery site [fake:goal]');
    await api.waitFor(id, 'goal', (c) => c.goal?.milestones.length === 2);
    await api.say(id, 'ceo', 'Publish the launch checklist as a dashboard [fake:dashboard]');
    await until(async () => (await api.view(id)).dashboards?.length > 0, 30_000, 'the dashboard');
    const { context, page } = await openPage(world, 'dashboards', `/c/${id}/dashboards`);
    const board = boardFrame(page, 'Dashboards');
    await board.getByRole('navigation', { name: 'Dashboards' }).waitFor({ timeout: 30_000 });
    const rec = await startRecording(world, page, 'dashboards');
    try {
      await sleep(1800);
      rec.mark('from');
      for (const label of ['Spend', 'Timeline', 'Launch checklist']) {
        await glideClick(page, board.getByRole('navigation', { name: 'Dashboards' }).getByText(label, { exact: true }).first());
        await sleep(1900);
      }
      await sleep(900);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    return [[world.last.marks.from, world.last.marks.to, 1]];
  },

  // The preview: the project's own app, running behind the office on an origin of its own.
  async preview(world) {
    const { api } = world;
    const folder = join(world.projects, 'bakery-preview');
    mkdirSync(folder, { recursive: true });
    const server = join(folder, 'bakery-site.mjs');
    writeFileSync(server, BAKERY_SITE);
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'corner-bakery', private: true, scripts: { dev: `node "${server}"` } }));
    world.setScript(scriptOf({ first: 'found' }));
    const found = await api.found(world, 'bakery-preview', 'A website for our corner bakery, with pickup orders');
    await api.waitFor(found.id, 'proposed', (c) => c.phase === 'proposed');
    world.setScript(scriptOf());
    await api.call(`api/c/${found.id}/settings`, { planApproval: 'off' });
    await api.call(`api/c/${found.id}/start`, {});
    await api.waitFor(found.id, 'running', (c) => c.phase === 'running');
    const { context, page } = await openPage(world, 'preview', `/c/${found.id}/preview`);
    const preview = page;
    await preview.getByRole('button', { name: 'Start the app' }).waitFor({ timeout: 30_000 });
    const rec = await startRecording(world, page, 'preview');
    try {
      await sleep(1500);
      rec.mark('from');
      await glideClick(page, preview.getByRole('button', { name: 'Start the app' }));
      const app = page.frameLocator('iframe');
      await app.getByRole('heading', { name: 'Corner Bakery' }).waitFor({ timeout: 60_000 });
      await sleep(1800);
      const path = preview.getByRole('textbox', { name: 'Path in the app' });
      await glideClick(page, path);
      await path.fill('');
      await page.keyboard.type('/menu', { delay: 90 });
      await page.keyboard.press('Enter');
      await sleep(2600);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await api.call(`api/c/${found.id}/preview`, { action: 'stop' }).catch(() => {});
      await context.close();
    }
    return [[world.last.marks.from, world.last.marks.to, 1]];
  },

  // A milestone: the last report is accepted, and the free people who worked on it stand up and clap, with streamers
  // falling in their room. The office's camera is zoomed in first: the people are small figures and the celebration is
  // a small one.
  async milestone(world) {
    const { api } = world;
    const { id } = await api.running(world, 'bakery-milestone');
    const quiet = (c) => c.people.every((p) => p.desk.state !== 'working' && p.desk.state !== 'starting');
    // As the office's own moments test sets it up: the owners finish (idle at their desks), the page is open, then the
    // milestone completes.
    await api.say(id, 'ceo', 'Set the goal for the bakery site [fake:goal]');
    await api.waitFor(id, 'goal', (c) => c.goal?.milestones.length === 2);
    await api.say(id, 'head-of-design', 'Plan the pickup flow with Lea [fake:assign-m1]');
    await api.waitFor(id, 'task', (c) => c.tasks.length === 1);
    await api.settle(id, 'ux-designer');
    await api.say(id, 'ux-designer', 'Report back when you are done [fake:report-done]');
    await api.waitFor(id, 'report', (c) => c.reports.length > 0);
    await api.waitFor(id, 'quiet', quiet);
    const { context, page } = await openPage(world, 'milestone', `/c/${id}`);
    await sceneReady(page);
    await walkDone(page, 3_000, 20_000);
    // Closer in: the office's camera zooms on the wheel, a little at a time while the room labels spread apart by the
    // factor wanted (the wheel events go straight to the canvas, as a mouse over it would send them).
    const spread = () =>
      page.evaluate(() => {
        const centre = (re) => {
          const el = [...document.querySelectorAll('.labels .label')].find((l) => re.test(l.textContent ?? ''));
          const r = el?.getBoundingClientRect();
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
        };
        const a = centre(/CEO's office/);
        const b = centre(/Meeting room/);
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      });
    await sleep(1500);
    const before = await spread();
    for (let i = 0; i < 30 && (await spread()) < before * ZOOM_FACTOR; i++) {
      await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 560, clientY: 440, bubbles: true, cancelable: true })));
      await sleep(120);
    }
    if ((await spread()) < before * ZOOM_FACTOR) world.log('  warning: the camera did not zoom in');
    await sleep(1500);
    if (world.probe) await page.screenshot({ path: join(world.probe, 'milestone-framed.png') });
    await api.waitFor(id, 'quiet at last', quiet);
    const rec = await startRecording(world, page, 'milestone');
    try {
      await sleep(1500);
      rec.mark('from');
      await api.say(id, 'head-of-design', 'Review the sketch from Lea [fake:accept]');
      await api.waitFor(id, 'milestone done', (c) => c.goal?.milestones[0]?.doneAt != null);
      const clapping = (c) => c.members.some((m) => m.pose === 'clap' || m.pose === 'cheer');
      // The streamers fall and the free people stand up and clap; wait for that, then for it to end.
      if (!(await sceneWait(page, (c) => c.celebration !== null && clapping(c), 8_000, 40))) world.log('  warning: no celebration was seen in the scene');
      rec.mark('celebrating');
      if (world.probe) await page.screenshot({ path: join(world.probe, 'milestone-celebrating.png') });
      await sceneWait(page, (c) => c.celebration === null, 5_000, 40);
      rec.mark('celebrated');
      await sceneWait(page, (c) => !clapping(c), 6_000, 40);
      await sleep(1400);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      world.milestone = world.last;
      await context.close();
    }
    const { marks } = world.last;
    return [[marks.from, marks.to, 1]];
  },

  // Steering: the CEO's plan waits for the stakeholder, who reads it and approves it.
  async steering(world) {
    const { api } = world;
    const { id } = await api.running(world, 'bakery-plan');
    const set = await api.call(`api/c/${id}/settings`, { planApproval: 'before-work' });
    if (set.status !== 200) throw new Error(`Settings gave ${set.status}.`);
    await api.say(id, 'ceo', 'Plan the menu page and the pickup orders [fake:plan]');
    await api.waitFor(id, 'plan', (c) => (c.steering?.plan?.versions.length ?? 0) === 1);
    const { context, page } = await openPage(world, 'steering', `/c/${id}/plan`);
    await boardFrame(page, 'Tasks').getByRole('button', { name: 'Approve the plan', exact: true }).waitFor({ timeout: 30_000 });
    const rec = await startRecording(world, page, 'steering');
    try {
      await sleep(2200);
      rec.mark('from');
      await glideTo(page, boardFrame(page, 'Tasks').getByText('Build the menu page').first());
      await sleep(1700);
      await glideClick(page, boardFrame(page, 'Tasks').getByRole('button', { name: 'Approve the plan', exact: true }));
      await sleep(2800);
      rec.mark('to');
    } finally {
      world.last = await rec.stop();
      await context.close();
    }
    return [[world.last.marks.from, world.last.marks.to, 1]];
  },
};

/** The project's dev server for the preview clip: a small bakery page that prints its address the way Vite does. */
const BAKERY_SITE = `import { createServer } from 'node:http';
const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const page = (path) => \`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Corner Bakery</title>
<style>
body{margin:0;font-family:Georgia,serif;background:#f6ecd9;color:#3a2a1c}
header{padding:40px 56px;background:#e4c28f;border-bottom:6px solid #b9803f}
h1{margin:0;font-size:56px;letter-spacing:-1px}
p.lead{margin:8px 0 0;font-size:22px}
main{padding:36px 56px;display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.card{background:#fffaf0;border:2px solid #e4c28f;border-radius:18px;padding:22px}
.card b{display:block;font-size:24px}.card span{color:#8a5a2b;font-size:20px}
a.go{display:inline-block;margin:0 56px;padding:14px 26px;background:#b9803f;color:#fffaf0;border-radius:999px;font:600 20px system-ui;text-decoration:none}
</style>
<header><h1>Corner Bakery</h1><p class="lead">\${path === '/menu' ? 'Today\\u2019s menu' : 'Fresh bread, every morning from six.'}</p></header>
<main>
<div class="card"><b>Sourdough loaf</b><span>CHF 7.50</span></div>
<div class="card"><b>Butter croissant</b><span>CHF 3.20</span></div>
<div class="card"><b>Cinnamon bun</b><span>CHF 3.80</span></div>
<div class="card"><b>Rye and seeds</b><span>CHF 8.00</span></div>
<div class="card"><b>Almond tart</b><span>CHF 4.50</span></div>
<div class="card"><b>Focaccia</b><span>CHF 5.90</span></div>
</main><a class="go" href="/menu">Order for pickup</a>\`;
createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page(req.url)); }).listen(port, '127.0.0.1', () => console.log(\`  Local:   http://127.0.0.1:\${port}/\`));
`;

// ---------------------------------------------------------------------------------------------------------------------
// Finishing: the files

function finishHero(world, out) {
  const { file, marks } = world.hero;
  const mp4 = join(out, 'hero.mp4');
  cutTo(heroPieces(world.hero, world.milestone, world.night), mp4);

  // A poster: the office at work, from the lossless-ish raw recording.
  const poster = join(out, 'hero-poster.png');
  ffmpeg(['-ss', (marks.working + 0.4).toFixed(2), '-i', file, '-frames:v', '1', poster], 'poster');

  // The GIF: a palette made for this video, at the widest size that stays under the limit.
  const gif = join(out, 'hero.gif');
  const limit = 8 * 1024 * 1024;
  for (const [width, fps] of [[960, 12], [880, 12], [800, 12], [720, 12], [720, 10], [640, 10]]) {
    const palette = join(world.work, 'palette.png');
    ffmpeg(['-i', mp4, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=160:stats_mode=diff`, palette], 'palette');
    ffmpeg(['-i', mp4, '-i', palette, '-lavfi', `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', gif], 'gif');
    world.log(`  gif ${width}px at ${fps} fps: ${kb(gif)}`);
    if (statSync(gif).size < limit) break;
  }
  return [mp4, gif, poster];
}

function finishClip(world, name, pieces, out) {
  const file = join(out, `${name}.mp4`);
  cutTo(pieces.map((p) => [world.last.file, ...p]), file);
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------
// The director

async function main() {
  const { chromium } = await import('@playwright/test');
  const out = resolve(args.out ?? join(root, 'docs', 'launch'));
  const clipsOut = join(out, 'clips');
  mkdirSync(clipsOut, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'worklings-video-'));
  const raw = join(work, 'raw');
  mkdirSync(raw, { recursive: true });
  const t0 = Date.now();
  const log = (text) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${text}`);
  const wanted = new Set((args.only ?? 'hero,clips').split(',').flatMap((n) => (n === 'clips' ? Object.keys(CLIPS) : [n])));
  // The hero's milestone beat is cut from the milestone recording.
  if (wanted.has('hero')) wanted.add('milestone');
  for (const n of wanted) if (n !== 'hero' && !CLIPS[n]) throw new Error(`Nothing to record called "${n}". Try hero, clips or one of: ${Object.keys(CLIPS).join(', ')}.`);

  // Companies live in a folder with a plain name. On Windows that is under the shared Public folder, so a path typed
  // into the start form shows no user name; elsewhere the system's temporary folder.
  const projects = process.platform === 'win32' ? 'C:\\Users\\Public\\worklings-video' : join(tmpdir(), 'worklings-video');
  const cleanups = [];
  const outputs = [];
  let failure = null;
  try {
    rmSync(projects, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    mkdirSync(projects, { recursive: true });
    cleanups.push(() => rmSync(projects, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

    const webDir = args['web-dir'] ? resolve(args['web-dir']) : join(work, 'web');
    if (!args['web-dir']) {
      log('building the web app');
      const built = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', webDir, '--emptyOutDir'], { cwd: root, encoding: 'utf8' });
      if (built.status !== 0) throw new Error(`vite build failed:\n${built.stdout}\n${built.stderr}`);
    }
    if (!existsSync(join(webDir, 'index.html'))) throw new Error(`No built web app in ${webDir}.`);

    const scriptFile = join(work, 'desk-script.json');
    const setScript = (script) => writeFileSync(scriptFile, JSON.stringify(script));
    setScript(scriptOf());

    const browser = await chromium.launch({ args: args.cpu ? [] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
    cleanups.push(() => browser.close());
    const world = { HUB: '', projects, raw, work, setScript, browser, log, errors: [], probe: args.probe ? resolve(args.probe) : null, api: null, hero: null, milestone: null, night: null, last: null };
    if (world.probe) mkdirSync(world.probe, { recursive: true });

    // Every recording gets a hub of its own: a hub holds a limited number of desks open, and a usage limit (the night)
    // rests every company it has. The hub stops when the recording is done, by the PID recorded here.
    let hubCount = 0;
    const onHub = async (label, run) => {
      const port = await freePort();
      const hubHome = join(work, `home-${++hubCount}`);
      mkdirSync(hubHome, { recursive: true });
      const env = {
        ...process.env, WORKLINGS_HOME: hubHome, WORKLINGS_CLAUDE: join(root, 'test', 'fake-desk.mjs'), FAKE_DESK_SCRIPT: scriptFile,
        FAKE_DESK_LOG: join(work, `desk-${hubCount}.jsonl`), FAKE_DESK_SESSIONS: join(work, `sessions-${hubCount}`), VIDEO_SCRATCH: join(work, `hub-${hubCount}`), VIDEO_PORT: String(port), VIDEO_WEB: webDir,
      };
      mkdirSync(env.VIDEO_SCRATCH, { recursive: true });
      delete env.CLAUDECODE;
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--hub'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const output = [];
      child.stdout.on('data', (d) => output.push(String(d)));
      child.stderr.on('data', (d) => output.push(String(d)));
      try {
        world.HUB = `http://127.0.0.1:${port}`;
        world.api = makeApi(world.HUB);
        await until(async () => (await fetch(`${world.HUB}/api/lobby`, { headers: auth }).then((r) => r.status, () => 0)) === 200, 60_000, 'the hub did not start');
        log(`${label}: hub on port ${port} (pid ${child.pid})`);
        return await run();
      } finally {
        stopTree(child);
        writeFileSync(join(work, `hub-${hubCount}.log`), output.join(''));
      }
    };

    if (wanted.has('hero')) {
      log('recording the hero');
      await onHub('hero', () => hero(world));
    }
    for (const name of Object.keys(CLIPS)) {
      if (!wanted.has(name)) continue;
      log(`recording ${name}`);
      const pieces = await onHub(name, () => CLIPS[name](world));
      outputs.push(finishClip(world, name, pieces, clipsOut));
    }
    if (wanted.has('hero')) {
      log('recording the night');
      await onHub('night', () => night(world));
      log('cutting the hero');
      outputs.unshift(...finishHero(world, out));
    }
    if (world.errors.length > 0) throw new Error(`The page logged errors:\n${[...new Set(world.errors)].join('\n')}`);
  } catch (e) {
    failure = e;
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (e) {
        console.error(`cleanup: ${e.message}`);
      }
    }
    if (args.keep) console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  if (failure) {
    console.error(failure.stack ?? failure);
    process.exit(1);
  }
  console.log('\nFiles:');
  for (const file of outputs) console.log(`  ${file.replace(`${root}`, '').replace(/\\/g, '/')}  ${kb(file)}${file.endsWith('.mp4') ? `  ${lengthOf(file).toFixed(1)} s` : ''}`);
}

if (!args.hub) await main();
