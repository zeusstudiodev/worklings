// v0.3, "See the app" (SPEC-v0.3.md, Q1): before the final review, the office runs the project's app and looks at it the way a
// person would, in a headless browser at a phone's width (375 px) and a desktop's (1440 px): it opens the pages the checklist's
// walks name, drives each walk's plain steps (src/core/acceptance.ts), keeps screenshots and the console's errors, and stops
// the app. The office does it, not a desk: no desk gets a browser or an MCP server for it. It keeps check-run's rules: the
// approvals policy must allow the commands as it would a desk's own (a dev script that listens beyond this computer, or opens
// a debugger, asks there and is not run here), no shell, the office's tokens and keys left out of the environment, everything
// it started stopped by the process it recorded, and the browser reaches nothing but this computer. What the app prints and
// shows is untrusted: it is masked and cut before anyone reads it. A project that isn't a web app is skipped with a note.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, join, relative } from 'node:path';
import { parseStep, type WalkStep } from '../core/acceptance.ts';
import { redactClip } from '../core/redact.ts';
import { classifyPermission } from '../runtime/approvals.ts';
import { killDesk } from '../server/claude.ts';
import { devScript, findNpm, localAddress, plainLine } from '../server/preview.ts';
import { checkEnv, type CheckRunner, runCheck, tailOf } from './check-run.ts';

/** The two widths the office looks at, phone first. */
export const LOOK_WIDTHS = [
  { width: 375, height: 812, name: 'phone' },
  { width: 1440, height: 900, name: 'desktop' },
] as const;
/** How long the app may take to serve a page, the browser a page, and a walk's step. */
const START_MS = 60_000;
const PAGE_MS = 15_000;
const STEP_MS = 6_000;
/** The whole look, start to stop. */
export const LOOK_TIMEOUT_MS = 4 * 60_000;
const MOST_PAGES = 4;
const MOST_ERRORS = 12;
const ERROR_CHARS = 240;

export interface LookWalk {
  /** The checklist item it accepts ("k-2"). */
  item: string;
  page: string;
  steps: string[];
}

export interface LookRequest {
  /** The project folder: the app runs here. */
  root: string;
  /** Where the screenshots go, inside the project's .worklings. */
  outDir: string;
  walks: LookWalk[];
  person: string;
  branch: string | null;
  signal?: AbortSignal;
}

export interface LookShot {
  /** Relative to the project, with forward slashes. */
  file: string;
  page: string;
  width: number;
  /** At a phone's width only: the page scrolls sideways. */
  overflow?: boolean;
}

export interface WalkResult {
  item: string;
  ok: boolean;
  /** The step that failed, as written, and why, in plain words; null when it passed. */
  step: string | null;
  why: string | null;
  shot: string | null;
}

export interface LookResult {
  /** seen: the office opened the app. failed: it is a web app and didn't serve a page. skipped: not a web app, or the office wouldn't run it. */
  state: 'seen' | 'failed' | 'skipped';
  /** A plain sentence about what the office did. */
  note: string;
  shots: LookShot[];
  /** Console errors, page errors and failed requests, masked and cut. */
  errors: string[];
  walks: WalkResult[];
}

/** The company's seam for looking at the app: tests pass a fake. */
export type LookRunner = (request: LookRequest) => Promise<LookResult>;

const done = (state: LookResult['state'], note: string, rest: Partial<LookResult> = {}): LookResult => ({ state, note, shots: [], errors: [], walks: [], ...rest });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const isLocalHost = (host: string): boolean => /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i.test(host);

/** A page's name for a file: "/" is "home", "/books/new" is "books-new". */
const slug = (path: string): string => path.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'home';

const scriptsOf = (root: string): Record<string, unknown> => {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
    const scripts = typeof pkg === 'object' && pkg !== null && 'scripts' in pkg ? pkg.scripts : null;
    return typeof scripts === 'object' && scripts !== null ? (scripts as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * up: it serves a page. ended: it stopped before serving one (a command-line tool, or a crash). wide: it says it listens on
 * every network, which the office doesn't run. none: it served nothing in time.
 */
type Started = { kind: 'up'; child: ChildProcessWithoutNullStreams; origin: string } | { kind: 'ended' | 'wide' | 'none'; why: string };

/** Starts the dev script and waits for it to serve: the address it prints, else the port it was given. */
async function startApp(root: string, script: string, signal: AbortSignal): Promise<Started> {
  const env = checkEnv();
  const npm = findNpm(env);
  if (!npm) return { kind: 'none', why: "The office couldn't find npm to start the app." };
  const port = await freePort();
  const child = spawn(npm.command, [...npm.args, 'run', script], {
    cwd: root,
    env: { ...env, PORT: String(port), HOST: '127.0.0.1' },
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  const lines: string[] = [];
  let printed: string | null = null;
  let wide = false;
  let exited: number | null | undefined;
  const read = (chunk: Buffer): void => {
    for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
      const line = plainLine(raw).slice(0, 400);
      if (!line.trim()) continue;
      lines.push(line);
      if (lines.length > 20) lines.shift();
      const found = localAddress(line);
      if (found && (found.host === '0.0.0.0' || found.host === '[::]')) wide = true;
      else if (found && printed === null) printed = `${found.secure ? 'https' : 'http'}://${found.host}:${found.port}`;
    }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  child.stdin.on('error', () => undefined);
  child.stdin.end();
  child.on('error', () => undefined);
  child.on('exit', (code) => {
    exited = code;
  });
  const answers = async (origin: string): Promise<boolean> => {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(2_000), redirect: 'manual' });
      await res.body?.cancel();
      return true;
    } catch {
      return false;
    }
  };
  const until = Date.now() + START_MS;
  while (Date.now() < until && !signal.aborted) {
    if (exited !== undefined) {
      const said = lines.findLast((l) => /error|cannot|not found|EADDRINUSE|failed/i.test(l)) ?? lines.at(-1) ?? '';
      return { kind: 'ended', why: `npm run ${script} ended (exit code ${exited ?? 'none'}) before it served a page${said ? `: ${redactClip(said.trim(), 200)}` : '.'}` };
    }
    // An app that says it listens on every network is reachable from beyond this computer: the office doesn't keep it up.
    if (wide) {
      await killDesk(child);
      return { kind: 'wide', why: `npm run ${script} listens on every network the computer is on, so the office stopped it; serve it on localhost only (127.0.0.1, or the HOST it is given).` };
    }
    for (const origin of [printed, `http://127.0.0.1:${port}`]) {
      if (origin !== null && (await answers(origin))) return { kind: 'up', child, origin };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await killDesk(child);
  return { kind: 'none', why: signal.aborted ? 'The company closed before the app started.' : `npm run ${script} served no page within ${START_MS / 1000} seconds.` };
}

/** Top-level folders a copy of the project leaves out: git, the office's records, and builds; and packages at any depth (linked instead). */
const NOT_COPIED = new Set(['.git', '.worklings', '.worklings-shared', 'dist', 'build', '.next', 'coverage', 'test-results']);

/**
 * A throwaway copy of the project for the app to run in, so nothing it writes (a database file, a build, test accounts the
 * walks sign up) lands in the person's project. Its packages are the project's own, linked in; a project with none
 * installs them in the copy, through check-run's runner (the policy, no shell, its environment). A string says why not.
 */
async function copyOf(request: LookRequest, runner: CheckRunner, signal: AbortSignal): Promise<{ dir: string; drop: () => void } | string> {
  const dir = mkdtempSync(join(tmpdir(), 'worklings-look-'));
  const modules = join(dir, 'node_modules');
  const drop = (): void => {
    // The link first, so removing the copy can never walk into the project's own packages.
    try {
      if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(modules);
    } catch {
      // checked below
    }
    // A link that is still there is left with its folder rather than risk a delete that follows it.
    if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) return;
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  };
  try {
    cpSync(request.root, dir, {
      recursive: true,
      filter: (src) => {
        const rel = relative(request.root, src);
        return rel === '' || (basename(src) !== 'node_modules' && !(rel === basename(src) && NOT_COPIED.has(rel)));
      },
    });
    const own = join(request.root, 'node_modules');
    if (existsSync(own)) {
      symlinkSync(own, modules, process.platform === 'win32' ? 'junction' : 'dir');
      return { dir, drop };
    }
    const command = 'npm install --no-audit --no-fund';
    const r = await runner({ command, cwd: dir, root: dir, branch: request.branch, person: request.person, signal });
    if (r.state === 'passed') return { dir, drop };
    drop();
    return `${command} ${r.state === 'failed' ? 'failed' : "wasn't run"}: ${tailOf(r.tail, 300)}`;
  } catch (error) {
    drop();
    return `the office couldn't copy the project to run it: ${firstLine(error)}`;
  }
}

// The Playwright surface the look uses, typed here so the office runs without @playwright/test where it isn't installed.
interface PwLocator {
  first(): PwLocator;
  or(other: PwLocator): PwLocator;
  click(o: { timeout: number }): Promise<void>;
  fill(value: string, o: { timeout: number }): Promise<void>;
  check(o: { timeout: number }): Promise<void>;
  selectOption(value: { label: string } | string, o: { timeout: number }): Promise<unknown>;
  waitFor(o: { state: 'visible'; timeout: number }): Promise<void>;
}
interface PwPage {
  goto(url: string, o: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  waitForLoadState(state: 'networkidle', o: { timeout: number }): Promise<void>;
  screenshot(o: { path: string }): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
  getByRole(role: 'button' | 'link', o: { name: string }): PwLocator;
  getByLabel(text: string): PwLocator;
  getByText(text: string): PwLocator;
  on(event: 'console', fn: (m: { type(): string; text(): string }) => void): void;
  on(event: 'pageerror', fn: (e: Error) => void): void;
  on(event: 'requestfailed', fn: (r: { url(): string; failure(): { errorText: string } | null }) => void): void;
}
interface PwRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  route(match: string, fn: (route: PwRoute) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(o: { viewport: { width: number; height: number }; serviceWorkers: 'block' }): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwChromium {
  launch(o: { headless: boolean; args: string[] }): Promise<PwBrowser>;
}

async function chromium(): Promise<PwChromium | string> {
  try {
    const name = '@playwright/test';
    const mod: unknown = await import(name);
    const c = typeof mod === 'object' && mod !== null && 'chromium' in mod ? mod.chromium : null;
    return c && typeof c === 'object' ? (c as PwChromium) : 'The office has no browser to look with (Playwright is not installed).';
  } catch {
    return 'The office has no browser to look with (Playwright is not installed).';
  }
}

const firstLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';

/** Why a step failed, as a person would say it. */
function whyStep(step: WalkStep, error: unknown): string {
  const timedOut = /timeout|exceeded/i.test(firstLine(error));
  if (!timedOut) return redactClip(firstLine(error), ERROR_CHARS);
  switch (step.verb) {
    case 'click':
      return `no button or link named "${step.target}" could be clicked`;
    case 'fill':
    case 'select':
    case 'check':
      return `no field labelled "${step.target}" could be used`;
    case 'see':
      return `"${step.target}" never showed on the page`;
    case 'open':
      return `the page ${step.target} didn't load`;
  }
}

/**
 * Looks at the app: the real runner. A project with no dev or start script is skipped; one whose script the policy wouldn't
 * run by itself is skipped with the reason; one that doesn't serve a page has failed (its walks with it).
 */
export function makeLookApp(runner: CheckRunner = runCheck): LookRunner {
  return async (request) => {
    const control = new AbortController();
    const stop = (): void => control.abort();
    request.signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, LOOK_TIMEOUT_MS);
    try {
      return await look(request, runner, control.signal);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', stop);
    }
  };
}

export const lookApp: LookRunner = makeLookApp();

async function look(request: LookRequest, runner: CheckRunner, signal: AbortSignal): Promise<LookResult> {
  const { root } = request;
  const detected = devScript(root);
  if (!detected.ok) return done('skipped', `Not a web app the office can open: ${detected.problem}`);
  const script = detected.dev.script;
  const verdict = classifyPermission({ tool_name: 'Bash', tool_input: { command: `npm run ${script}` } }, { root, cwd: root, branch: request.branch, rules: [], person: request.person });
  if (verdict.verdict !== 'allow') return done('skipped', `The office doesn't start npm run ${script} by itself, because it would ${verdict.verdict === 'ask' ? `ask first (${verdict.summary})` : 'be refused'}.`);
  const browserType = await chromium();
  if (typeof browserType === 'string') return done('skipped', browserType);
  const copy = await copyOf(request, runner, signal);
  if (typeof copy === 'string') return done('failed', `The app couldn't be prepared, so no walk ran: ${copy}`);
  try {
    return await lookIn(copy.dir, script, request, runner, browserType, signal);
  } finally {
    copy.drop();
  }
}

/** Builds when it should, starts the app in the copy, looks at it, and stops it. */
async function lookIn(dir: string, script: 'dev' | 'start', request: LookRequest, runner: CheckRunner, browserType: PwChromium, signal: AbortSignal): Promise<LookResult> {
  const { root } = request;
  // A start script usually serves what a build made: build first when there is one.
  if (script === 'start' && typeof scriptsOf(dir).build === 'string') {
    const built = await runner({ command: 'npm run build', cwd: dir, root: dir, branch: request.branch, person: request.person, signal });
    if (built.state === 'unrunnable') return done('skipped', `The office didn't build the app by itself: ${tailOf(built.tail, 300)}`);
    if (built.state !== 'passed') return done('failed', `npm run build failed, so the app wasn't started and no walk ran: ${tailOf(built.tail, 300)}`);
  }
  const started = await startApp(dir, script, signal);
  if (started.kind === 'wide') return done('skipped', started.why);
  // A command-line tool with a start script ends at once: with no walk to run, it simply has no pages to look at.
  if (started.kind === 'ended' && request.walks.length === 0) return done('skipped', `Not a web app the office can open: ${started.why}`);
  if (started.kind !== 'up') return done('failed', `${started.why} No walk ran.`);
  mkdirSync(request.outDir, { recursive: true });
  const rel = (file: string): string => relative(root, file).split('\\').join('/');
  const errors: string[] = [];
  const noteError = (text: string): void => {
    const line = redactClip(plainLine(text).replace(/\s+/g, ' ').trim(), ERROR_CHARS);
    if (line && errors.length < MOST_ERRORS && !errors.includes(line)) errors.push(line);
  };
  let browser: PwBrowser | null = null;
  try {
    try {
      // No name but this computer's resolves, for WebSockets and anything else the request filter below doesn't see.
      browser = await browserType.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]'] });
    } catch (error) {
      return done('skipped', `The office couldn't open its browser (${redactClip(firstLine(error), 200)}), so it didn't look at the app.`);
    }
    const context = async (width: number, height: number): Promise<{ ctx: PwContext; page: PwPage }> => {
      if (!browser) throw new Error('The browser closed.');
      const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      // Nothing beyond this computer: the app's page may name any address, and the office reaches only the app.
      await ctx.route('**/*', async (route) => {
        let host = '';
        try {
          host = new URL(route.request().url()).hostname;
        } catch {
          // data: and blob: have no host and stay on the page.
        }
        if (host === '' || isLocalHost(host)) await route.continue();
        else await route.abort();
      });
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') noteError(m.text());
      });
      page.on('pageerror', (e) => noteError(e.message));
      page.on('requestfailed', (r) => {
        try {
          if (isLocalHost(new URL(r.url()).hostname)) noteError(`${r.url().replace(started.origin, '')} failed: ${r.failure()?.errorText ?? 'no answer'}`);
        } catch {
          // an address that doesn't parse says nothing
        }
      });
      return { ctx, page };
    };
    const settle = async (page: PwPage): Promise<void> => {
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
    };

    const shots: LookShot[] = [];
    const pages = [...new Set(['/', ...request.walks.map((w) => w.page)])].slice(0, MOST_PAGES);
    for (const path of pages) {
      for (const size of LOOK_WIDTHS) {
        if (signal.aborted) break;
        const { ctx, page } = await context(size.width, size.height);
        try {
          await page.goto(started.origin + path, { waitUntil: 'load', timeout: PAGE_MS });
          await settle(page);
          const file = join(request.outDir, `${slug(path)}-${size.name}.png`);
          await page.screenshot({ path: file });
          const overflow = size.name === 'phone' ? (await page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) === true : undefined;
          shots.push({ file: rel(file), page: path, width: size.width, ...(overflow === undefined ? {} : { overflow }) });
        } catch (error) {
          noteError(`${path} at ${size.width} px didn't load: ${firstLine(error)}`);
        } finally {
          await ctx.close().catch(() => undefined);
        }
      }
    }

    const walks: WalkResult[] = [];
    for (const walk of request.walks) {
      if (signal.aborted) break;
      const unique = randomBytes(3).toString('hex');
      const phone = LOOK_WIDTHS[0];
      const { ctx, page } = await context(phone.width, phone.height);
      let failed: { step: string; why: string } | null = null;
      try {
        await page.goto(started.origin + walk.page, { waitUntil: 'load', timeout: PAGE_MS }).catch((error: unknown) => {
          failed = { step: `open "${walk.page}"`, why: `the page didn't load: ${firstLine(error)}` };
        });
        await settle(page);
        for (const text of failed === null ? walk.steps : []) {
          const step = parseStep(text);
          if (typeof step === 'string') {
            failed = { step: text, why: step };
            break;
          }
          const value = 'value' in step ? step.value.replaceAll('{unique}', unique) : '';
          try {
            if (step.verb === 'open') await page.goto(started.origin + step.target, { waitUntil: 'load', timeout: PAGE_MS });
            else if (step.verb === 'click') await page.getByRole('button', { name: step.target }).or(page.getByRole('link', { name: step.target })).first().click({ timeout: STEP_MS });
            else if (step.verb === 'fill') await page.getByLabel(step.target).first().fill(value, { timeout: STEP_MS });
            else if (step.verb === 'select') await page.getByLabel(step.target).first().selectOption({ label: value }, { timeout: STEP_MS });
            else if (step.verb === 'check') await page.getByLabel(step.target).first().check({ timeout: STEP_MS });
            else await page.getByText(step.target).first().waitFor({ state: 'visible', timeout: STEP_MS });
            if (step.verb === 'click' || step.verb === 'open') await settle(page);
          } catch (error) {
            failed = { step: text, why: whyStep(step, error) };
            break;
          }
        }
        const file = join(request.outDir, `walk-${slug(walk.item)}${failed ? '-failed' : ''}.png`);
        const shot = await page.screenshot({ path: file }).then(
          () => rel(file),
          () => null,
        );
        const f: { step: string; why: string } | null = failed;
        walks.push({ item: walk.item, ok: f === null, step: f?.step ?? null, why: f?.why ?? null, shot });
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
    const passed = walks.filter((w) => w.ok).length;
    const note = `The office opened the app (npm run ${script}) at 375 and 1440 px: ${shots.length} screenshot${shots.length === 1 ? '' : 's'}, ${errors.length} console error${errors.length === 1 ? '' : 's'}${walks.length > 0 ? `, ${passed} of ${walks.length} acceptance walk${walks.length === 1 ? '' : 's'} passed` : ''}.`;
    return { state: 'seen', note, shots, errors, walks };
  } catch (error) {
    return done('failed', `The office couldn't look at the app: ${redactClip(firstLine(error), 300)}`, { errors });
  } finally {
    await browser?.close().catch(() => undefined);
    await killDesk(started.child);
  }
}
