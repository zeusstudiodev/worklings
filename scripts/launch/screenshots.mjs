// Takes the README's screenshots (docs/images/v3/*.png) and the office screenshot the social preview uses
// (docs/launch/office-screenshot.png) from the demo company, so they always show the current stage and dock.
//
//   node scripts/launch/screenshots.mjs [--only <name>[,<name>]] [--out <folder>] [--web-dir <built web app>] [--cpu]
//
// Names: proposal, people-at-work, inbox-approval, plan-approval, dashboards, lobby, phone, office. inbox-approval, phone
// and office show the demo lobby's plain job (Recipe box); the rest show the team demo. The first seven go to
// docs/images/v3 (or --out); `office` goes to docs/launch/office-screenshot.png (or --out), 1440x900 like the others.
// Needs Playwright's Chromium. About 40 seconds, nothing is published.
//
// How: the web app is built into a temporary folder and served by the real hub (in this process, with no companies and no
// Claude Code), and the pages open the hub's made-up demo company (Cafe Lumen and its four neighbours in the lobby:
// web/src/company/demo.ts). The desktop shots are 1440x900; the phone shot is 375x812 at twice the pixels. Nothing real
// shows: the script stops if this machine's user name or home folder is ever in the page text or a page logs an error.
/* global document */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values: args } = parseArgs({ options: { only: { type: 'string' }, out: { type: 'string' }, 'web-dir': { type: 'string' }, cpu: { type: 'boolean' } } });
const TOKEN = 'shots-token-0123456789abcdefghijklmnopqrstuv';
const escaped = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
// A user name as short as "matte" is inside ordinary words ("matters"), so it matches as a whole word.
const FORBIDDEN = [userInfo().username, homedir()].filter((s) => s && s.length > 3).map((s) => ({ label: s, test: new RegExp(String.raw`(?<!\w)${escaped(s)}(?!\w)`, 'i') }));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const { chromium } = await import('@playwright/test');
const { loadLibrary } = await import(new URL('../../src/composer/library.ts', import.meta.url).href);
const { startHub } = await import(new URL('../../src/hub/index.ts', import.meta.url).href);

const imagesOut = resolve(args.out ?? join(root, 'docs', 'images', 'v3'));
const launchOut = resolve(args.out ?? join(root, 'docs', 'launch'));
mkdirSync(imagesOut, { recursive: true });
mkdirSync(launchOut, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'worklings-shots-'));
const errors = [];
let hub = null;
let browser = null;

/** Waits until the 3D scene is drawing (its labels are placed over it) and has settled for a moment. */
const sceneReady = async (page) => {
  await page.waitForFunction(() => [...document.querySelectorAll('.labels .label')].some((l) => l.getBoundingClientRect().width > 0), null, { timeout: 30_000 });
  await sleep(2500);
};

const open = async (page, path) => {
  await page.goto(`${hub.url.replace(/\/$/, '')}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`);
};
const side = (page) => page.getByRole('complementary', { name: 'Side panel' });

/** Each shot gets a fresh page at the hub and leaves it ready to capture. */
const SHOTS = {
  async proposal(page) {
    // The chart over the office and the proposal's summary beside it (the summary comes after the CEO's questions, so the
    // panel is scrolled down to it).
    await open(page, '/c/plant-pal/org?panel=proposal&demo');
    await side(page).getByRole('heading', { name: "The CEO's proposal" }).waitFor({ timeout: 30_000 });
    await page.getByRole('region', { name: 'Org chart', exact: true }).getByRole('treeitem').first().waitFor({ timeout: 30_000 });
    await side(page).getByRole('region', { name: 'Summary' }).scrollIntoViewIfNeeded();
    await sleep(2500);
  },
  async 'people-at-work'(page) {
    // The org chart with who is doing what and what each has cost, and one person's panel beside it.
    await open(page, '/c/demo/org?panel=people/frontend-engineer');
    await side(page).getByRole('button', { name: 'Message Kai' }).waitFor({ timeout: 30_000 });
    await page.getByRole('region', { name: 'Org chart', exact: true }).getByRole('treeitem').first().waitFor({ timeout: 30_000 });
    await sleep(2500);
  },
  async 'inbox-approval'(page) {
    // A plain job's office (v0.8): Claude Code at the desk, its helpers beside it, and its permission prompt on the inbox
    // card over the talk bar.
    await open(page, '/c/recipe-box?demo');
    await page.locator('[data-inbox-card]').getByRole('button', { name: 'Allow once' }).waitFor({ timeout: 30_000 });
    await sceneReady(page);
  },
  async 'plan-approval'(page) {
    await open(page, '/c/demo/plan');
    await page.getByRole('heading', { name: 'The plan' }).first().waitFor({ timeout: 30_000 });
    await sleep(2500);
  },
  async dashboards(page) {
    await open(page, '/c/demo/dashboards');
    await page.getByRole('region', { name: 'Dashboards', exact: true }).getByRole('heading', { level: 2, name: 'Dashboards', exact: true }).waitFor({ timeout: 30_000 });
    await sleep(2500);
  },
  async lobby(page) {
    await open(page, '/?demo');
    await page.getByRole('heading', { name: 'Companies' }).waitFor({ timeout: 30_000 });
    await sceneReady(page);
  },
  async phone(page) {
    // The same plain job on a phone (v0.8): the office first, the prompt on the inbox card above the talk bar.
    await open(page, '/c/recipe-box?demo');
    await page.locator('[data-inbox-card]').getByRole('button', { name: 'Allow once' }).waitFor({ timeout: 30_000 });
    await sceneReady(page);
  },
  async office(page) {
    await open(page, '/c/recipe-box?demo');
    await sceneReady(page);
    await sleep(2500);
  },
};
const fileOf = (name) => (name === 'office' ? join(launchOut, 'office-screenshot.png') : join(imagesOut, `${name}.png`));

try {
  const webDir = args['web-dir'] ? resolve(args['web-dir']) : join(work, 'web');
  if (!args['web-dir']) {
    console.log('building the web app');
    const built = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', webDir, '--emptyOutDir'], { cwd: root, encoding: 'utf8' });
    if (built.status !== 0) throw new Error(`vite build failed:\n${built.stdout}\n${built.stderr}`);
  }
  if (!existsSync(join(webDir, 'index.html'))) throw new Error(`No built web app in ${webDir}.`);

  // The hub serves the web app and its demo company. No desk ever starts, so Claude Code is never run; the pointer at
  // the fake keeps it so if that ever changes.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  hub = await startHub({ port: 0, token: TOKEN, webDir, library: loadLibrary(), home: join(work, 'home'), claude: join(root, 'test', 'fake-desk.mjs'), env, tickMs: 50 });
  browser = await chromium.launch({ args: args.cpu ? [] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });

  const wanted = (args.only ?? Object.keys(SHOTS).join(',')).split(',');
  for (const name of wanted) if (!SHOTS[name]) throw new Error(`No shot called "${name}". Try: ${Object.keys(SHOTS).join(', ')}.`);
  for (const name of wanted) {
    const phone = name === 'phone';
    const context = await browser.newContext(
      phone
        ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' }
        : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${name}: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`${name}: ${r.status()} ${r.url().replace(TOKEN, '...')}`);
    });
    await SHOTS[name](page);
    const text = await page.evaluate('document.body.innerText');
    for (const bad of FORBIDDEN) if (bad.test.test(text)) errors.push(`${name}: "${bad.label}" shows on screen`);
    // A panel that opens takes focus on its heading; the ring is for keyboards, not for a picture.
    await page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
    await page.screenshot({ path: fileOf(name) });
    console.log(`  ${fileOf(name).replace(root, '').replace(/\\/g, '/')}`);
    await context.close();
  }
  if (errors.length > 0) throw new Error(`The pages logged problems:\n${[...new Set(errors)].join('\n')}`);
} finally {
  await browser?.close();
  await hub?.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
process.exit(0);
