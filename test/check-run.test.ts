// The runner that gives the office's own gate (src/company/check-run.ts): the real one, on small Node scripts in a temp
// folder. A check is a plain command from the approved plan: judged as a desk's own Bash would be, started as an argument
// list with no shell, in the task's folder, stopped with everything it started at a timeout, its output bounded and masked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECK_TAIL_CHARS, checkEnv, runCheck, stepsOf, tailOf } from '../src/company/check-run.ts';
import { tempDir } from './library-kit.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanups.splice(0)) undo();
});

function project(files: Record<string, string>): string {
  const root = tempDir('worklings-check-');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

const run = (root: string, command: string, extra: { cwd?: string; timeoutMs?: number } = {}) =>
  runCheck({ command, cwd: extra.cwd ?? root, root, branch: null, person: 'frontend-engineer', ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}) });

describe('runCheck', () => {
  it('passes on exit 0 and fails on any other, with the end of the output either way', async () => {
    const root = project({
      'ok.mjs': "console.log('12 passing');",
      'fail.mjs': "console.log('3 passing'); console.error('1 failing: the menu has no Flat white'); process.exit(3);",
    });
    expect(await run(root, 'node ok.mjs')).toEqual({ state: 'passed', tail: '12 passing' });
    const failed = await run(root, 'node fail.mjs');
    expect(failed.state).toBe('failed');
    expect(failed.tail).toContain('1 failing: the menu has no Flat white');
    expect(failed.tail).toContain('Exit code 3.');
  });

  it('runs && steps in order and stops at the first that fails', async () => {
    const root = project({ 'a.mjs': "console.log('A');", 'b.mjs': "console.log('B'); process.exit(1);", 'c.mjs': "console.log('C');" });
    const result = await run(root, 'node a.mjs && node b.mjs && node c.mjs');
    expect(result.state).toBe('failed');
    expect(result.tail).toContain('A');
    expect(result.tail).toContain('B');
    expect(result.tail).not.toContain('C\n');
  });

  it('runs in the task folder, and a cd stays inside it', async () => {
    const root = project({ 'sub/where.mjs': "console.log('in ' + process.cwd().split(/[\\\\/]/).at(-1));" });
    expect((await run(root, 'cd sub && node where.mjs')).tail).toBe('in sub');
    expect((await run(root, 'node where.mjs', { cwd: join(root, 'sub') })).tail).toBe('in sub');
    const out = await run(root, 'cd .. && node where.mjs', { cwd: join(root, 'sub') });
    expect(out).toMatchObject({ state: 'unrunnable' });
    expect(out.tail).toContain("outside the task's folder");
  });

  it('stops a check that runs too long, with everything it started', async () => {
    const root = project({
      'child.mjs': "setTimeout(() => {}, 60_000);",
      'slow.mjs': "import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const c = spawn(process.execPath, ['child.mjs'], { stdio: 'ignore' }); writeFileSync('pids.txt', `${process.pid} ${c.pid}`); console.log('started'); setTimeout(() => {}, 60_000);",
    });
    const began = Date.now();
    const result = await run(root, 'node slow.mjs', { timeoutMs: 1_500 });
    expect(Date.now() - began).toBeLessThan(20_000);
    expect(result.state).toBe('failed');
    expect(result.tail).toContain('The check ran past 2 seconds, so the office stopped it.');
    const [parent, child] = readFileSync(join(root, 'pids.txt'), 'utf8').split(' ').map(Number);
    const alive = (pid: number | undefined): boolean => {
      try {
        process.kill(pid ?? 0, 0);
        return true;
      } catch {
        return false;
      }
    };
    // Give the system a moment to reap them.
    for (let i = 0; i < 20 && (alive(parent) || alive(child)); i += 1) await new Promise((done) => setTimeout(done, 100));
    expect(alive(parent)).toBe(false);
    expect(alive(child)).toBe(false);
  }, 30_000);

  it('keeps only the end of a flood of output, and stops one that never ends', async () => {
    const root = project({
      'flood.mjs': "const line = 'x'.repeat(1000) + '\\n'; for (let i = 0; i < 3000; i += 1) process.stdout.write(line); console.log('THE END'); process.exit(1);",
    });
    const result = await run(root, 'node flood.mjs');
    expect(result.state).toBe('failed');
    expect(result.tail.length).toBeLessThanOrEqual(CHECK_TAIL_CHARS + 2);
    expect(result.tail).toContain('THE END');
  }, 30_000);

  it('masks secrets in what it prints and strips colours', async () => {
    const root = project({ 'p.mjs': "console.log('\\u001b[31mred\\u001b[0m token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789abcdefghij'); process.exit(1);" });
    const result = await run(root, 'node p.mjs');
    expect(result.tail).toContain('red');
    expect(result.tail).not.toContain('\u001b');
    expect(result.tail).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it("doesn't hand the office's tokens or keys to what it runs", async () => {
    const root = project({ 'env.mjs': "console.log(JSON.stringify([process.env.WORKLINGS_DESK_TOKEN ?? null, process.env.ANTHROPIC_API_KEY ?? null, process.env.CI ?? null]));" });
    const was = [process.env.WORKLINGS_DESK_TOKEN, process.env.ANTHROPIC_API_KEY];
    process.env.WORKLINGS_DESK_TOKEN = 'desk-token-1234';
    process.env.ANTHROPIC_API_KEY = 'sk-test-1234';
    cleanups.push(() => {
      for (const [key, value] of [['WORKLINGS_DESK_TOKEN', was[0]], ['ANTHROPIC_API_KEY', was[1]]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    expect((await run(root, 'node env.mjs')).tail).toBe('[null,null,"1"]');
  });

  it('is judged as a desk\'s own Bash first: a push, the network or a pipe is not run, and the reason is given', async () => {
    const root = project({ 'ok.mjs': "console.log('ran');" });
    const push = await run(root, 'git push origin main');
    expect(push.state).toBe('unrunnable');
    expect(push.tail).toMatch(/doesn't run this check by itself, because it would ask first/);
    expect((await run(root, 'curl https://example.com/x')).state).toBe('unrunnable');
    const piped = await run(root, 'node ok.mjs | cat');
    expect(piped).toMatchObject({ state: 'unrunnable' });
    expect(piped.tail).toMatch(/pipe, a redirect, a substitution or a background marker/);
    expect((await run(root, 'node ok.mjs > out.txt')).state).toBe('unrunnable');
    expect(existsSync(join(root, 'out.txt'))).toBe(false);
  });

  it('does not run what it cannot start as plain commands', async () => {
    const root = project({ 'ok.mjs': "console.log('ran');" });
    expect((await run(root, 'FOO=1 node ok.mjs')).tail).toContain('sets an environment variable');
    // A program the policy doesn't know would ask first, so the office doesn't run it.
    expect((await run(root, 'definitely-not-a-program-xyz')).tail).toContain('would ask first');
    expect((await run(root, 'node $(echo ok.mjs)')).state).toBe('unrunnable');
    expect((await run(root, '')).state).toBe('unrunnable');
  });

  it('can be stopped from outside, for a company that closes', async () => {
    const root = project({ 'slow.mjs': 'setTimeout(() => {}, 60_000);' });
    const control = new AbortController();
    const pending = runCheck({ command: 'node slow.mjs', cwd: root, root, branch: null, person: 'x', signal: control.signal });
    setTimeout(() => control.abort(), 300);
    const result = await pending;
    expect(result).toMatchObject({ state: 'unrunnable', tail: 'The company closed before the check finished.' });
  }, 30_000);
});

describe('stepsOf', () => {
  it('reads node, npm and npx without a shell, and the arguments as the command wrote them', () => {
    const root = tempDir('worklings-check-');
    const steps = stepsOf('npm run typecheck && node --test "test/a b.test.js"', root, checkEnv());
    expect(Array.isArray(steps)).toBe(true);
    if (!Array.isArray(steps)) return;
    expect(steps.map((s) => s.kind)).toEqual(['run', 'run']);
    expect(steps[0]?.args.slice(-2)).toEqual(['run', 'typecheck']);
    expect(steps[1]).toMatchObject({ file: process.execPath, args: ['--test', 'test/a b.test.js'] });
  });
});

describe('tailOf', () => {
  it('keeps the end, with an ellipsis where it cut', () => {
    expect(tailOf('a\nb\nc', 100)).toBe('a\nb\nc');
    const cut = tailOf(`${'x'.repeat(500)}END`, 50);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('END')).toBe(true);
  });
});
