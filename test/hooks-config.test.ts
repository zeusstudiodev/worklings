import { readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS, hooksStatus, hookUrl, ignoreLocalSettings, installHooks, settingsFile, uninstallHooks, wouldIgnoreLocalSettings } from '../src/server/hooks-config.ts';
import { tempDir, writeTree } from './library-kit.ts';

/** The hook URL versions from before the rename wrote, when the tool was called Headcount. */
const LEGACY_URL = (port: number) => `http://127.0.0.1:${port}/hooks?from=headcount`;
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

type Hooks = Record<string, unknown[]>;
type Settings = { permissions: unknown; hooks: Hooks };

/** The office's hooks the way an install writes them: one group per event, any tool for the tool events. */
const office = (url: string): Hooks =>
  Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'http', url, timeout: 2 }], ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}) }]]));

/** Someone else's settings and hooks, two of them with URLs that only look like the office's. */
const THEIRS: Settings = {
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --check .' }] }],
    Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9000/hooks?from=worklings-bot', timeout: 5 }] }],
    Notification: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9001/hooks?from=headcounter' }] }],
  },
};

/** Their settings with the given sets of office hooks after their own, as a later install leaves them. */
function settings(...sets: Hooks[]): Settings {
  const hooks = structuredClone(THEIRS.hooks);
  for (const set of sets) for (const [event, groups] of Object.entries(set)) (hooks[event] ??= []).push(...groups);
  return { ...THEIRS, hooks };
}

function fileWith(value: Settings): string {
  return join(writeTree(tempDir(), { '.claude/settings.local.json': value }), '.claude', 'settings.local.json');
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as unknown;

const OLD = office(LEGACY_URL(7500));
const CURRENT = office(hookUrl(7500));

describe('hooks an earlier version installed', () => {
  it('count as the office hooks and are flagged as legacy', () => {
    const status = hooksStatus(fileWith(settings(OLD)));
    expect(status).toMatchObject({ installed: true, port: 7500, legacy: true });
    expect([...status.events].sort()).toEqual([...HOOK_EVENTS].sort());
  });

  it('are counted once per event next to current ones', () => {
    const status = hooksStatus(fileWith(settings(OLD, CURRENT)));
    expect(status.events).toHaveLength(HOOK_EVENTS.length);
    expect(status.legacy).toBe(true);
  });

  it.each([
    ['only old hooks', [OLD]],
    ['old and current hooks', [OLD, CURRENT]],
  ])('give way to one current hook per event on install, from %s', (_case, sets) => {
    const file = fileWith(settings(...sets));
    installHooks(file, 7501);
    expect(read(file)).toEqual(settings(office(hookUrl(7501))));
    expect(hooksStatus(file)).toMatchObject({ installed: true, port: 7501, legacy: false });
  });

  it.each([
    ['only old hooks', [OLD], HOOK_EVENTS.length],
    ['only current hooks', [CURRENT], HOOK_EVENTS.length],
    ['old and current hooks', [OLD, CURRENT], 2 * HOOK_EVENTS.length],
  ])("are removed on uninstall with everyone else's kept, from %s", (_case, sets, removed) => {
    const file = fileWith(settings(...sets));
    expect(uninstallHooks(file)).toEqual({ removed });
    expect(read(file)).toEqual(THEIRS);
  });
});

describe('current hooks', () => {
  it('are not flagged as legacy', () => {
    expect(hooksStatus(fileWith(settings(CURRENT)))).toMatchObject({ installed: true, port: 7500, legacy: false });
  });
});

describe("hooks that only look like the office's", () => {
  it('are never counted, replaced or removed', () => {
    const file = fileWith(settings());
    expect(hooksStatus(file)).toEqual({ installed: false, port: null, events: [], legacy: false });
    expect(uninstallHooks(file)).toEqual({ removed: 0 });
    installHooks(file, 7500);
    expect(uninstallHooks(file)).toEqual({ removed: HOOK_EVENTS.length });
    expect(read(file)).toEqual(THEIRS);
  });
});

describe('a project that ships links', () => {
  type Context = { skip: (note?: string) => never };

  /** Makes `path` a link to `target`; skips the test where this machine won't (file links on Windows need Developer Mode). */
  function link(ctx: Context, target: string, path: string, kind: 'dir' | 'file') {
    try {
      // A directory junction needs no special rights on Windows; elsewhere both are plain symlinks.
      symlinkSync(target, path, kind === 'file' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(code)) ctx.skip(`this machine can't make a ${kind} link (${code})`);
      throw error;
    }
  }

  it("won't write the office's hooks through a .claude folder that links elsewhere", (ctx) => {
    const root = tempDir();
    const elsewhere = tempDir();
    link(ctx, elsewhere, join(root, '.claude'), 'dir');
    expect(() => installHooks(settingsFile(root), 7500, root)).toThrow(".claude is a symlink or junction; Worklings doesn't read or write through links.");
    expect(() => uninstallHooks(settingsFile(root), root)).toThrow('symlink or junction');
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("won't write through a settings file that links elsewhere", (ctx) => {
    const root = writeTree(tempDir(), { '.claude/': '' });
    const theirs = join(writeTree(tempDir(), { 'settings.json': { permissions: {} } }), 'settings.json');
    link(ctx, theirs, join(root, '.claude', 'settings.local.json'), 'file');
    expect(() => installHooks(settingsFile(root), 7500, root)).toThrow('.claude/settings.local.json is a symlink or junction');
    expect(read(theirs)).toEqual({ permissions: {} });
  });

  it("won't add to a .gitignore that links elsewhere", (ctx) => {
    const root = writeTree(tempDir(), { '.git/': '' });
    const theirs = join(writeTree(tempDir(), { gitignore: 'node_modules\n' }), 'gitignore');
    link(ctx, theirs, join(root, '.gitignore'), 'file');
    expect(() => ignoreLocalSettings(root)).toThrow('.gitignore is a symlink or junction');
    expect(readFileSync(theirs, 'utf8')).toBe('node_modules\n');
  });

  it('writes as before in a project without links', () => {
    const root = writeTree(tempDir(), { '.git/': '' });
    installHooks(settingsFile(root), 7500, root);
    expect(hooksStatus(settingsFile(root))).toMatchObject({ installed: true, port: 7500 });
    expect(ignoreLocalSettings(root)).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.claude/settings.local.json\n');
    expect(uninstallHooks(settingsFile(root), root)).toEqual({ removed: HOOK_EVENTS.length });
  });
});

describe("a project's .gitignore", () => {
  it('is read only as a file of at most 1 MB, as a settings file is', () => {
    const big = writeTree(tempDir(), { '.git/': '', '.gitignore': `${'#'.repeat(1024 * 1024)}\n` });
    expect(() => wouldIgnoreLocalSettings(big)).toThrow('.gitignore is bigger than 1 MB');
    expect(() => ignoreLocalSettings(big)).toThrow('.gitignore is bigger than 1 MB');
    const folder = writeTree(tempDir(), { '.git/': '', '.gitignore/': '' });
    expect(() => wouldIgnoreLocalSettings(folder)).toThrow(".gitignore is not a file, so Worklings won't read it.");
  });

  it('reads one of up to 1 MB as before', () => {
    const root = writeTree(tempDir(), { '.git/': '', '.gitignore': 'node_modules\n' });
    expect(wouldIgnoreLocalSettings(root)).toBe(true);
    expect(ignoreLocalSettings(root)).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules\n.claude/settings.local.json\n');
    expect(wouldIgnoreLocalSettings(root)).toBe(false);
  });
});
