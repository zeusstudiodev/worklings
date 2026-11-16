// Scores what a run produced against the task's hidden tests (which live outside the repo, in BENCH_ROOT).
//
//   node scripts/bench/score.mjs <task> <out>
//
// Works on a copy of <out>/project in <out>/scoring/project, so scoring can be repeated. Steps: npm install, build,
// typecheck, lint and the project's own tests (each null when the project has none), then the hidden tests, copied
// in at this point. Writes <out>/score.json and prints a summary.
// Each task has a core suite and may have an edge suite (edge cases and errors the goal states or implies), scored apart
// in score.hidden.core and score.hidden.edge; hiddenTotal and hiddenPassed are the core suite's, as before.
//   link-checker  node --test (TAP) against the project's built `bin` (linkcheck.test.mjs, linkcheck-edge.test.mjs)
//   pomodoro      Playwright at 1440 and 375 px against the project's `npm run dev` (or `preview`, or its built folder),
//                 with an axe scan; needs the Playwright browsers `npm run e2e` already uses
//   feature       vitest on the hidden files, copied to test/hidden-find-gaps(-edge).test.ts
//   api           node --test: the suite starts the built server itself (npm start, PORT, DATA_FILE, CLOCK)
//   game          Playwright at 1440 and 375 px, like pomodoro
//   bookshop      node --test against the built server (core: the JSON API and the importer, edge: CSV and limit cases), and
//                 a ui suite: Playwright at 1440 and 375 px against `npm start`, like household
//   bugfix, refactor, multifile, data-script (v0.7)  node --test, core and edge
//   household     node --test against the built server (core: the JSON API, household-api.test.mjs), and a ui suite:
//                 Playwright at 1440 and 375 px against `npm start` (a fresh DB_FILE, CLOCK 2030-03-15T10:00Z)
// The hidden total is fixed by the hidden files, so a crash scores the missing tests as failed.
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { BENCH_ROOT, copyTree, die, freePort, killTree, now, readJson, removeTree, REPO, requireTask, sh, sleep, tail, taskDir, writeJson } from './lib.mjs';

const task = requireTask(process.argv[2]);
const out = resolve(process.argv[3] ?? '');
const projectDir = join(out, 'project');
if (!process.argv[3] || !existsSync(projectDir)) {
  process.stderr.write(`No project to score: expected ${projectDir}. Run run-a.mjs or run-b.mjs first.\n`);
  process.exit(2);
}
const scoring = join(out, 'scoring');
// A junction to this repo's node_modules from an earlier scoring is unlinked first (rmdir takes the link, never its target),
// so the recursive delete below can never walk into the repo's packages.
const junction = join(scoring, 'hidden', 'node_modules');
if (existsSync(junction) && lstatSync(junction).isSymbolicLink()) rmdirSync(junction);
removeTree(scoring);
mkdirSync(scoring, { recursive: true });
const work = join(scoring, 'project');
copyTree(projectDir, work);
const hiddenSrc = join(taskDir(task), 'hidden');
const env = { ...process.env, CI: '1', BENCH_PROJECT: work, NO_COLOR: '1', FORCE_COLOR: '0' };
delete env.CLAUDECODE;

const step = (name, ran) => ({ name, ok: ran.code === 0, code: ran.code, timedOut: ran.timedOut, ms: ran.ms, tail: tail(`${ran.stdout}\n${ran.stderr}`, 30) });
const score = { task, scoredAt: new Date().toISOString(), steps: {} };

const hasPackage = existsSync(join(work, 'package.json'));
const pkg = hasPackage ? safeJson(join(work, 'package.json')) : null;
const scripts = pkg?.scripts ?? {};

function safeJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

// --- the project's own steps ---------------------------------------------------------------------------------------
if (hasPackage) {
  score.steps.install = step('install', sh('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: work, env, timeoutMs: 600_000 }));
  if (scripts.build) score.steps.build = step('build', sh('npm', ['run', 'build'], { cwd: work, env, timeoutMs: 600_000 }));
  if (scripts.typecheck) score.steps.typecheck = step('typecheck', sh('npm', ['run', 'typecheck'], { cwd: work, env, timeoutMs: 300_000 }));
  else if (existsSync(join(work, 'tsconfig.json'))) score.steps.typecheck = step('typecheck', sh('npx', ['--no-install', 'tsc', '--noEmit'], { cwd: work, env, timeoutMs: 300_000 }));
  if (scripts.lint) score.steps.lint = step('lint', sh('npm', ['run', 'lint'], { cwd: work, env, timeoutMs: 300_000 }));
  // Before the hidden tests go in, so a hidden failure never counts against the project's own suite.
  if (scripts.test) score.steps.ownTests = step('ownTests', sh('npm', ['test'], { cwd: work, env, timeoutMs: 300_000 }));
}
const okOf = (name) => (score.steps[name] ? score.steps[name].ok : null);
score.installOk = okOf('install');
score.buildOk = okOf('build');
score.typecheckOk = okOf('typecheck');
score.lintOk = okOf('lint');
score.ownTestsOk = okOf('ownTests');

/** Why a hidden run produced no results: the lines that say so, else the last of its output. */
const why = (ran) => {
  const text = `${ran.stdout}\n${ran.stderr}`;
  return text.split('\n').filter((l) => /rror|\bbin\b|cannot|not found/i.test(l)).slice(0, 6).join('\n') || tail(text, 10);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };

/** The app's address: its own dev server first, then its preview, then its built folder served here. Returns { url, stop, how }. */
/**
 * A full-stack project serves its own UI: `npm start` with PORT, a fresh DB_FILE and the CLOCK the UI flows assume,
 * until `/` answers. Stopped by its PID's tree.
 */
async function startFullStack() {
  const port = await freePort();
  const log = [];
  const child = spawn('npm start', { cwd: work, env: { ...env, PORT: String(port), DB_FILE: join(scoring, 'ui.db'), CLOCK: '2030-03-15T10:00:00.000Z' }, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  child.on('close', () => {
    exited = true;
  });
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  const stop = () => killTree(child.pid);
  const url = `http://127.0.0.1:${port}`;
  const deadline = now() + 60_000;
  while (now() < deadline && !exited) {
    if (await fetch(url, { signal: AbortSignal.timeout(2_000) }).then((r) => r.status < 500, () => false)) return { url, stop, how: 'npm start', pid: child.pid };
    await sleep(500);
  }
  stop();
  score.serveFailures = [...(score.serveFailures ?? []), { how: 'npm start', log: tail(log.join(''), 15) }];
  return null;
}

async function serveApp() {
  const attempts = [];
  if (scripts.dev) attempts.push({ how: 'npm run dev', args: ['run', 'dev'] });
  if (scripts.preview) attempts.push({ how: 'npm run preview', args: ['run', 'preview'] });
  for (const attempt of attempts) {
    const port = await freePort();
    const log = [];
    const command = `npm ${attempt.args.join(' ')} -- --port ${port}`;
    const child = spawn(command, { cwd: work, env: { ...env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none' }, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let exited = false;
    child.on('close', () => {
      exited = true;
    });
    child.stdout.on('data', (c) => log.push(String(c)));
    child.stderr.on('data', (c) => log.push(String(c)));
    const stop = () => killTree(child.pid);
    const deadline = now() + 90_000;
    while (now() < deadline && !exited) {
      const found = [...new Set([...log.join('').matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/g)].map((m) => m[1]).concat(String(port)))];
      for (const p of found) {
        for (const host of ['localhost', '127.0.0.1']) {
          const url = `http://${host}:${p}`;
          const answered = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then((r) => r.status < 500, () => false);
          if (answered) return { url, stop, how: attempt.how, pid: child.pid };
        }
      }
      await sleep(500);
    }
    stop();
    score.serveFailures = [...(score.serveFailures ?? []), { how: attempt.how, log: tail(log.join(''), 15) }];
  }
  for (const dir of ['dist', 'build', 'out', '.']) {
    const root = join(work, dir);
    if (!existsSync(join(root, 'index.html'))) continue;
    const server = createServer((req, res) => {
      const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      let file = join(root, rawPath);
      if (!file.startsWith(root)) file = join(root, 'index.html');
      if (!existsSync(file) || statSync(file).isDirectory()) file = existsSync(join(file, 'index.html')) ? join(file, 'index.html') : join(root, 'index.html');
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
    const port = await freePort();
    await new Promise((done) => server.listen(port, '127.0.0.1', done));
    return { url: `http://127.0.0.1:${port}`, stop: () => server.close(), how: `static ${dir}` };
  }
  return null;
}

// --- hidden tests ---------------------------------------------------------------------------------------------------
// Each task has a core suite (the acceptance tests the 12 Nov runs used, or a new task's) and may have an edge suite: the
// edge cases and errors the goal states or clearly implies. They are scored and reported apart, so a core result stays
// comparable with earlier runs.
const countIn = (file, pattern) => (readFileSync(file, 'utf8').match(pattern) ?? []).length;

const suiteResult = (total, passed, failed, ran) => {
  const seen = new Set([...passed, ...failed]);
  return { total, passed: passed.length, failed, notRun: Math.max(0, total - seen.size), runTail: passed.length + failed.length === 0 && ran ? why(ran) : undefined };
};

/** A `node --test` suite that runs the built project itself (it finds it through BENCH_PROJECT). */
async function nodeSuite(file) {
  const path = join(hiddenSrc, file);
  const total = countIn(path, /^test\(/gm);
  const ran = sh(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', path], { cwd: work, env, timeoutMs: 600_000 });
  const passed = [];
  const failed = [];
  for (const line of ran.stdout.split(/\r?\n/)) {
    const m = /^(not ok|ok) \d+ - (.*)$/.exec(line);
    if (!m || /\.mjs$/.test(m[2])) continue; // a file-level failure (the suite did not load) is not a test
    (m[1] === 'ok' ? passed : failed).push(m[2]);
  }
  return suiteResult(total, passed, failed, ran);
}

/** A vitest file copied into the project's own test folder and run with the project's vitest. */
async function vitestSuite(file, target) {
  const path = join(hiddenSrc, file);
  const total = countIn(path, /^\s+it\(/gm);
  mkdirSync(join(work, 'test'), { recursive: true });
  writeFileSync(join(work, 'test', target), readFileSync(path));
  const json = join(scoring, `vitest-${target}.json`);
  const ran = sh('npx', ['--no-install', 'vitest', 'run', `test/${target}`, '--reporter=json', `--outputFile=${json}`], { cwd: work, env, timeoutMs: 300_000 });
  const passed = [];
  const failed = [];
  for (const suite of (existsSync(json) ? safeJson(json) : null)?.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) (t.status === 'passed' ? passed : failed).push(t.title);
  }
  return suiteResult(total, passed, failed, ran);
}

/** A Playwright suite against the served app, at the widths its config names (1440 and 375). */
async function playwrightSuite(config, spec, serve = serveApp) {
  const total = countIn(join(hiddenSrc, spec), /^\s*test\('/gm) * 2;
  const hidden = join(scoring, 'hidden');
  if (!existsSync(join(hidden, config))) {
    copyTree(hiddenSrc, hidden);
    // The suite resolves @playwright/test from this repo's packages, through a junction (no copy, no install).
    symlinkSync(join(REPO, 'node_modules'), join(hidden, 'node_modules'), 'junction');
  }
  const served = await serve();
  if (!served) return { ...suiteResult(total, [], [], null), runTail: serve === serveApp ? 'No server: the project has no dev or preview script that came up and no built folder with an index.html.' : 'No server: `npm start` did not answer on its PORT within 60 s.' };
  score.serve = { how: served.how, url: served.url };
  const json = join(scoring, `playwright-${spec}.json`);
  const ran = sh(process.execPath, [join(REPO, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '-c', join(hidden, config)], {
    cwd: hidden,
    env: { ...env, BENCH_URL: served.url, BENCH_AXE: join(BENCH_ROOT, 'node_modules', 'axe-core', 'axe.min.js'), BENCH_JSON: json, BENCH_ARTIFACTS: join(scoring, `artifacts-${spec}`) },
    timeoutMs: 900_000,
  });
  served.stop();
  const passed = [];
  const failed = [];
  const walk = (suite) => {
    for (const s of suite.specs ?? []) for (const t of s.tests ?? []) (t.status === 'expected' ? passed : failed).push(`${t.projectName}: ${s.title}`);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of (existsSync(json) ? (safeJson(json)?.suites ?? []) : [])) walk(suite);
  return suiteResult(total, passed, failed, ran);
}

const SUITES = {
  'link-checker': { core: ['linkcheck.test.mjs', () => nodeSuite('linkcheck.test.mjs')], edge: ['linkcheck-edge.test.mjs', () => nodeSuite('linkcheck-edge.test.mjs')] },
  feature: { core: ['find-gaps.test.ts', () => vitestSuite('find-gaps.test.ts', 'hidden-find-gaps.test.ts')], edge: ['find-gaps-edge.test.ts', () => vitestSuite('find-gaps-edge.test.ts', 'hidden-find-gaps-edge.test.ts')] },
  pomodoro: { core: ['pomodoro.spec.mjs', () => playwrightSuite('playwright.config.mjs', 'pomodoro.spec.mjs')], edge: ['pomodoro-edge.spec.mjs', () => playwrightSuite('playwright-edge.config.mjs', 'pomodoro-edge.spec.mjs')] },
  api: { core: ['api.test.mjs', () => nodeSuite('api.test.mjs')] },
  game: { core: ['game.spec.mjs', () => playwrightSuite('playwright.config.mjs', 'game.spec.mjs')] },
  household: {
    core: ['household-api.test.mjs', () => nodeSuite('household-api.test.mjs')],
    ui: ['household-ui.spec.mjs', () => playwrightSuite('household-ui.config.mjs', 'household-ui.spec.mjs', startFullStack)],
  },
  // v0.7: the existing-code tasks of the parity bench, each a node --test core and edge suite (the multifile suites start
  // the server themselves; the refactor core suite is the byte-identity guard, which passes on the starting point too).
  bugfix: { core: ['bugfix.test.mjs', () => nodeSuite('bugfix.test.mjs')], edge: ['bugfix-edge.test.mjs', () => nodeSuite('bugfix-edge.test.mjs')] },
  refactor: { core: ['refactor.test.mjs', () => nodeSuite('refactor.test.mjs')], edge: ['refactor-edge.test.mjs', () => nodeSuite('refactor-edge.test.mjs')] },
  multifile: { core: ['multifile.test.mjs', () => nodeSuite('multifile.test.mjs')], edge: ['multifile-edge.test.mjs', () => nodeSuite('multifile-edge.test.mjs')] },
  'data-script': { core: ['data-script.test.mjs', () => nodeSuite('data-script.test.mjs')], edge: ['data-script-edge.test.mjs', () => nodeSuite('data-script-edge.test.mjs')] },
  // v0.6 (E2): a stock app with a JSON API, a web UI and a CSV importer (an API job and a command line), parts with a contract.
  bookshop: {
    core: ['bookshop-api.test.mjs', () => nodeSuite('bookshop-api.test.mjs')],
    edge: ['bookshop-edge.test.mjs', () => nodeSuite('bookshop-edge.test.mjs')],
    ui: ['bookshop-ui.spec.mjs', () => playwrightSuite('bookshop-ui.config.mjs', 'bookshop-ui.spec.mjs', startFullStack)],
  },
}[task];
// A task with no hidden folder at all (bookclub, judged by the blind review only) scores the project's own steps and no hidden suite.
if (!SUITES && existsSync(hiddenSrc)) die(`No hidden suites are known for ${task}.`);
score.hidden = {};
if (!SUITES) score.noHiddenTests = `${task} has no hidden tests: the blind review is its only measure of quality.`;
for (const [name, [file, run]] of Object.entries(SUITES ?? {})) if (existsSync(join(hiddenSrc, file))) score.hidden[name] = await run();
const junctionLeft = join(scoring, 'hidden', 'node_modules');
if (existsSync(junctionLeft) && lstatSync(junctionLeft).isSymbolicLink()) rmdirSync(junctionLeft);
// The core suite under the names the 12 Nov report reads.
const core = score.hidden.core ?? suiteResult(0, [], [], null);
Object.assign(score, { hiddenTotal: core.total, hiddenPassed: core.passed, hiddenFailed: core.failed, hiddenNotRun: core.notRun, hiddenRunTail: core.runTail });


// Screens and traces a failing Playwright run left stay in <out>/scoring; the project copy is not needed any more.
removeTree(join(work, 'node_modules'));
writeJson(join(out, 'score.json'), score);

const mark = (v) => (v === null ? 'n/a' : v ? 'ok' : 'FAIL');
console.log(`${task}: hidden ${score.hiddenPassed}/${score.hiddenTotal}${score.hiddenNotRun ? ` (${score.hiddenNotRun} did not run)` : ''} | install ${mark(score.installOk)}, build ${mark(score.buildOk)}, typecheck ${mark(score.typecheckOk)}, lint ${mark(score.lintOk)}, own tests ${mark(score.ownTestsOk)}${score.serve ? ` | served by ${score.serve.how}` : ''}`);
if (score.hiddenFailed.length > 0) console.log(`failed: ${score.hiddenFailed.slice(0, 8).join('; ')}${score.hiddenFailed.length > 8 ? '; ...' : ''}`);
if (score.hiddenRunTail) console.log(`hidden run output:\n${score.hiddenRunTail}`);
