import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadToken } from '../src/server/token.ts';
import { tempDir, writeTree } from './library-kit.ts';

const TOKEN_FILE = '.worklings/token';
// Where versions from before the rename (the tool was called Headcount) kept the token, and what moved it.
const LEGACY_TOKEN_FILE = '.headcount/token';
const LEGACY_HOME_ENV = 'HEADCOUNT_HOME';
const OLD_TOKEN = 'saved-before-the-rename-0123456789abcdef';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the office token', () => {
  it('stays the one saved before the rename, copied to the new folder', () => {
    const home = writeTree(tempDir(), { [LEGACY_TOKEN_FILE]: `${OLD_TOKEN}\n` });
    expect(loadToken(home)).toBe(OLD_TOKEN);
    expect(readFileSync(join(home, TOKEN_FILE), 'utf8')).toBe(`${OLD_TOKEN}\n`);
    expect(loadToken(home)).toBe(OLD_TOKEN);
    expect(readFileSync(join(home, LEGACY_TOKEN_FILE), 'utf8')).toBe(`${OLD_TOKEN}\n`);
  });

  it.skipIf(process.platform === 'win32')('is copied readable by its owner only', () => {
    const home = writeTree(tempDir(), { [LEGACY_TOKEN_FILE]: `${OLD_TOKEN}\n` });
    loadToken(home);
    expect(statSync(join(home, TOKEN_FILE)).mode & 0o777).toBe(0o600);
  });

  it('is the current one when both folders have a token', () => {
    const current = 'saved-after-the-rename-0123456789abcdef';
    const home = writeTree(tempDir(), { [TOKEN_FILE]: `${current}\n`, [LEGACY_TOKEN_FILE]: `${OLD_TOKEN}\n` });
    expect(loadToken(home)).toBe(current);
    expect(readFileSync(join(home, LEGACY_TOKEN_FILE), 'utf8')).toBe(`${OLD_TOKEN}\n`);
  });

  it('is new when the old file holds no token', () => {
    const home = writeTree(tempDir(), { [LEGACY_TOKEN_FILE]: 'not a token\n' });
    const token = loadToken(home);
    expect(token).toMatch(/^[\w-]{32,}$/);
    expect(readFileSync(join(home, TOKEN_FILE), 'utf8')).toBe(`${token}\n`);
    expect(readFileSync(join(home, LEGACY_TOKEN_FILE), 'utf8')).toBe('not a token\n');
  });

  it('is new, not the old one again, after its file is deleted', () => {
    const home = writeTree(tempDir(), { [LEGACY_TOKEN_FILE]: `${OLD_TOKEN}\n` });
    loadToken(home);
    unlinkSync(join(home, TOKEN_FILE));
    const token = loadToken(home);
    expect(token).not.toBe(OLD_TOKEN);
    expect(token).toMatch(/^[\w-]{32,}$/);
  });

  it('lives under WORKLINGS_HOME, which wins over HEADCOUNT_HOME', () => {
    const home = tempDir();
    const legacyHome = writeTree(tempDir(), { [LEGACY_TOKEN_FILE]: `${OLD_TOKEN}\n` });
    vi.stubEnv('WORKLINGS_HOME', home);
    vi.stubEnv(LEGACY_HOME_ENV, legacyHome);
    // Never let loadToken() fall through to the real home folder.
    expect(process.env.WORKLINGS_HOME).toBe(home);
    const token = loadToken();
    expect(token).not.toBe(OLD_TOKEN);
    expect(readFileSync(join(home, TOKEN_FILE), 'utf8')).toBe(`${token}\n`);
    expect(existsSync(join(legacyHome, TOKEN_FILE))).toBe(false);
  });

  it('lives under HEADCOUNT_HOME when WORKLINGS_HOME is not set', () => {
    const legacyHome = writeTree(tempDir(), { [LEGACY_TOKEN_FILE]: `${OLD_TOKEN}\n` });
    vi.stubEnv('WORKLINGS_HOME', undefined);
    vi.stubEnv(LEGACY_HOME_ENV, legacyHome);
    expect(process.env[LEGACY_HOME_ENV]).toBe(legacyHome);
    expect(loadToken()).toBe(OLD_TOKEN);
    expect(readFileSync(join(legacyHome, TOKEN_FILE), 'utf8')).toBe(`${OLD_TOKEN}\n`);
  });
});
