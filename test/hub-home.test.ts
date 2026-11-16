import { copyFileSync, existsSync, linkSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HeldByAnotherHub, HubHomeError, hubDir, KEY_BYTES, loadHubKey, readRegistry, readSettings, runningHub, stakeholderName, takeCompanyLock, takeLock, updateSettings,
  worklingsHome, writeRegistry,
} from '../src/hub/home.ts';
import { tempDir, writeTree } from './library-kit.ts';

/** Git reading only the given global config: no system config, and a folder outside any repository. */
function gitWith(config: string | null) {
  const dir = tempDir('worklings-git-');
  const file = join(dir, 'gitconfig');
  if (config !== null) writeFileSync(file, config);
  return { env: { ...process.env, GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1' }, cwd: dir };
}

describe("the hub's folder", () => {
  it('lives where the office token does: WORKLINGS_HOME, then the old name, then the home folder', () => {
    expect(worklingsHome({ WORKLINGS_HOME: 'C:\\a', HEADCOUNT_HOME: 'C:\\b' })).toBe('C:\\a');
    expect(worklingsHome({ HEADCOUNT_HOME: 'C:\\b' })).toBe('C:\\b');
    const dir = hubDir(tempDir());
    expect(existsSync(dir)).toBe(true);
    expect(dir.endsWith('.worklings')).toBe(true);
  });
});

describe('the hub key', () => {
  it('is 32 random bytes made once, then read back', () => {
    const dir = hubDir(tempDir());
    const key = loadHubKey(dir);
    expect(key).toHaveLength(KEY_BYTES);
    expect(loadHubKey(dir)).toEqual(key);
    expect(loadHubKey(hubDir(tempDir()))).not.toEqual(key);
  });

  it.skipIf(process.platform === 'win32')('is readable by its owner only', () => {
    const dir = hubDir(tempDir());
    loadHubKey(dir);
    expect(statSync(join(dir, 'hub.key')).mode & 0o777).toBe(0o600);
  });

  it('is made again when the first start left it empty, and stops the hub when it is damaged', () => {
    const dir = hubDir(tempDir());
    writeFileSync(join(dir, 'hub.key'), '');
    expect(loadHubKey(dir)).toHaveLength(KEY_BYTES);
    writeFileSync(join(dir, 'hub.key'), 'short');
    expect(() => loadHubKey(dir)).toThrow(HubHomeError);
    expect(() => loadHubKey(dir)).toThrow(/should hold 32 bytes but holds 5\. Put back the original/);
  });
});

describe('the registry', () => {
  it('starts empty, and keeps id and folder per company', () => {
    const dir = hubDir(tempDir());
    expect(readRegistry(dir)).toEqual([]);
    const entries = [{ id: 'plant-pal', root: join(tempDir(), 'plant-pal') }, { id: 'cafe-lumen', root: join(tempDir(), 'cafe') }];
    writeRegistry(dir, entries);
    expect(readRegistry(dir)).toEqual(entries);
    expect(JSON.parse(readFileSync(join(dir, 'companies.json'), 'utf8'))).toEqual({ version: 1, companies: entries });
  });

  it('skips entries without a usable id or folder, and second entries for one company', () => {
    const root = join(tempDir(), 'p');
    const dir = writeTree(hubDir(tempDir()), {
      'companies.json': {
        companies: [
          { id: 'plant-pal', root }, { id: '--debug', root: join(tempDir(), 'q') }, { id: 'rel', root: 'relative/path' }, { id: '__proto__', root: join(tempDir(), 'r') },
          { id: 'plant-pal', root: join(tempDir(), 's') }, { id: 'twin', root: `${root}/` }, 'nonsense',
        ],
      },
    });
    const warned: string[] = [];
    expect(readRegistry(dir, (line) => warned.push(line))).toEqual([{ id: 'plant-pal', root }]);
    expect(warned).toHaveLength(6);
  });

  it("stops the hub rather than forget its companies when the file isn't its list", () => {
    const dir = writeTree(hubDir(tempDir()), { 'companies.json': '{ not json' });
    expect(() => readRegistry(dir)).toThrow(/isn't the hub's list of companies\. Fix it, or delete it and add the folders again/);
  });
});

describe('the settings', () => {
  it('reads a usable stakeholder name and cap, and ignores the rest', () => {
    const dir = writeTree(hubDir(tempDir()), { 'settings.json': { stakeholder: ' Robin ', maxDesks: 6, tailnetPort: 7431, theme: 'dark' } });
    expect(readSettings(dir)).toEqual({ stakeholder: 'Robin', maxDesks: 6, tailnetPort: 7431 });
    const odd = writeTree(hubDir(tempDir()), { 'settings.json': { stakeholder: '<script>', maxDesks: 0.5, tailnetPort: 80 } });
    expect(readSettings(odd)).toEqual({ stakeholder: null, maxDesks: null, tailnetPort: null });
  });

  it("changes one setting and keeps the person's other keys, but never rewrites a file that isn't JSON", () => {
    const dir = writeTree(hubDir(tempDir()), { 'settings.json': { stakeholder: 'Robin', theme: 'dark' } });
    updateSettings(dir, { maxDesks: 4 });
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ stakeholder: 'Robin', theme: 'dark', maxDesks: 4 });
    writeFileSync(join(dir, 'settings.json'), '{ broken');
    expect(() => updateSettings(dir, { maxDesks: 4 })).toThrow(/isn't a JSON object, so Worklings won't change it/);
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{ broken');
  });
});

describe("the stakeholder's name", () => {
  it('comes from the settings first', async () => {
    const dir = writeTree(hubDir(tempDir()), { 'settings.json': { stakeholder: 'Ada' } });
    const git = gitWith('[user]\n\tname = Grace Hopper\n');
    expect(await stakeholderName(dir, git.cwd, git.env)).toBe('Ada');
  });

  it("is the first word of git's user.name otherwise", async () => {
    const git = gitWith('[user]\n\tname = Grace Hopper\n');
    expect(await stakeholderName(hubDir(tempDir()), git.cwd, git.env)).toBe('Grace');
  });

  it("never comes from a git of the folder's own, which a relative PATH entry would find first", async () => {
    const git = gitWith('[user]\n\tname = Grace Hopper\n');
    // Node under git's name, with the "config" script it runs for `git config --get user.name`: a start by name shows.
    const planted = join(git.cwd, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      linkSync(process.execPath, planted);
    } catch {
      copyFileSync(process.execPath, planted); // another volume than Node's: no link across
    }
    writeFileSync(join(git.cwd, 'config'), "process.stdout.write('Mallory Planted');\n");
    const env = { ...git.env, PATH: `.${delimiter}${process.env.PATH ?? ''}` };
    expect(await stakeholderName(hubDir(tempDir()), git.cwd, env)).toBe('Grace');
  });

  it('is empty when neither says, or git names something that is no name', async () => {
    const none = gitWith(null);
    expect(await stakeholderName(hubDir(tempDir()), none.cwd, none.env)).toBe('');
    const odd = gitWith('[user]\n\tname = <bot>\n');
    expect(await stakeholderName(hubDir(tempDir()), odd.cwd, odd.env)).toBe('');
  });
});

describe('the lock', () => {
  it('names the running hub, and is released by it', () => {
    const dir = hubDir(tempDir());
    expect(runningHub(dir)).toBeNull();
    const release = takeLock(dir, 7444);
    expect(runningHub(dir)).toEqual({ pid: process.pid, port: 7444 });
    release();
    expect(runningHub(dir)).toBeNull();
  });

  it("refuses while another live process holds it, and takes over a dead one's", () => {
    const dir = hubDir(tempDir());
    writeFileSync(join(dir, 'hub.lock'), JSON.stringify({ pid: process.ppid, port: 7445 }));
    expect(() => takeLock(dir, 7446)).toThrow(`Another Worklings hub is running (process ${process.ppid}, port 7445)`);
    // No process has a pid this high on Windows, Linux or macOS.
    writeFileSync(join(dir, 'hub.lock'), JSON.stringify({ pid: 2 ** 30, port: 7445 }));
    takeLock(dir, 7446)();
  });

  it("leaves a later hub's lock alone when an earlier one in this process closes", () => {
    const dir = hubDir(tempDir());
    const first = takeLock(dir, 7447);
    takeLock(dir, 7448);
    first();
    expect(runningHub(dir)).toEqual({ pid: process.pid, port: 7448 });
  });

  it('never writes over a lock another hub is still writing, and takes over one a hub left half-written', () => {
    const dir = hubDir(tempDir());
    // Made a moment ago, with nothing in it yet: the hub that made it is about to write its process and port.
    const file = join(dir, 'hub.lock');
    writeFileSync(file, '');
    expect(() => takeLock(dir, 7449)).toThrow('Another Worklings hub is starting. Wait a moment, or stop it first.');
    expect(readFileSync(file, 'utf8')).toBe('');
    const minuteAgo = (Date.now() - 60_000) / 1000;
    utimesSync(file, minuteAgo, minuteAgo);
    const release = takeLock(dir, 7449);
    expect(runningHub(dir)).toEqual({ pid: process.pid, port: 7449 });
    release();
    // Nothing is left beside it from the takeover.
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("a company's own lock", () => {
  it('is taken in the folder and given back by the hub that took it', () => {
    const root = tempDir();
    const release = takeCompanyLock(root, 7450);
    expect(JSON.parse(readFileSync(join(root, '.worklings', 'hub.lock'), 'utf8'))).toEqual({ pid: process.pid, port: 7450, root });
    expect(readFileSync(join(root, '.worklings', '.gitignore'), 'utf8')).toBe('*\n');
    release();
    expect(readdirSync(join(root, '.worklings'))).toEqual(['.gitignore']);
  });

  it("refuses while a live hub elsewhere has the company, naming it, and takes over a gone hub's lock or one copied with the folder", () => {
    const root = tempDir();
    const lock = (holder: object) => writeTree(root, { '.worklings/hub.lock': holder });
    lock({ pid: process.ppid, port: 7999, root });
    expect(() => takeCompanyLock(root, 7451)).toThrow(HeldByAnotherHub);
    expect(() => takeCompanyLock(root, 7451)).toThrow(
      `Another Worklings hub runs this company (process ${process.ppid}, port 7999). Open it at http://127.0.0.1:7999/, or stop that hub and add the folder here again.`,
    );
    // No process has a pid this high on Windows, Linux or macOS.
    lock({ pid: 2 ** 30, port: 7999, root });
    takeCompanyLock(root, 7451)();
    // The folder was copied while a hub ran it from where it was.
    lock({ pid: process.ppid, port: 7999, root: join(tempDir(), 'plant-pal') });
    takeCompanyLock(root, 7451)();
    expect(readdirSync(join(root, '.worklings'))).toEqual(['.gitignore']);
  });
});
