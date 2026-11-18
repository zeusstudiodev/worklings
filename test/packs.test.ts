// v0.9 (SPEC-v0.9.md): packs, opt-in Claude Code setup in a project's .claude/. 0.4.0 ships Kickoff alone. The catalogue
// against the library's files, the recommendations, the record, the installer and its removal, and the start form's Add
// row.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanFolderPacks, cleanPackIds, noPacks, PACK_IDS, PACK_RECORD, PACKS, parsePackRecord, recommendPacks, RECOMMENDED, stateOf, taskKinds } from '../src/core/packs.ts';
import { blockedWhy, folderPacks, installPacks, jobPacks, PackRefusal, readRecord, removePack, sourceOf, undoInstall } from '../src/packs/install.ts';
import { LIBRARY_DIR } from '../src/paths.ts';
import { packRowView, packsToSend, PACKS_LEAD } from '../web/src/company/start/packRowModel.ts';
import { packsLine } from '../web/src/company/progress/progressModel.ts';
import { tempDir } from './library-kit.ts';

const KIND = { domain: null, empty: false };
const RULE = 'rules/worklings-kickoff.md';

/** Every file under a folder, as forward-slash paths relative to it. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (at: string) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(at, e.name));
      else out.push(relative(dir, join(at, e.name)).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

describe('the catalogue', () => {
  it('ships Kickoff alone, naming exactly the files library/packs holds, each starting with worklings-', () => {
    expect(PACK_IDS).toEqual(['kickoff']);
    for (const pack of PACKS) {
      expect(filesUnder(join(LIBRARY_DIR, 'packs', pack.id))).toEqual([...pack.files].sort());
      for (const file of pack.files) expect(file.split('/').at(-1)).toMatch(/^worklings-/);
    }
    expect(readdirSync(join(LIBRARY_DIR, 'packs')).sort()).toEqual([...PACK_IDS].sort());
  });

  it('recommends nothing: the bench met no rule, and the table stays as benched', () => {
    expect(RECOMMENDED).toEqual({ kickoff: [] });
  });

  it('writes its rule without frontmatter, so Claude Code loads it in every session', () => {
    expect(readFileSync(sourceOf('kickoff', RULE), 'utf8').startsWith('---')).toBe(false);
  });

  it("says what the bench measured on Kickoff's card, the stand-in included", () => {
    const kickoff = PACKS[0];
    expect(kickoff?.measured).toContain('all 6 runs');
    expect(kickoff?.measured).toContain('a stand-in who knew the full request');
    expect(kickoff?.measured).toContain('about 3x a plain guess');
  });

  it('takes pack names it knows and refuses others with the list, the packs that were measured and not shipped too', () => {
    expect(cleanPackIds(['kickoff', 'kickoff'])).toEqual({ ok: true, ids: ['kickoff'] });
    expect(cleanPackIds(undefined)).toEqual({ ok: true, ids: [] });
    for (const name of ['check-before-done', 'review-round', 'superpowers']) {
      const bad = cleanPackIds(['kickoff', name]);
      expect(bad.ok).toBe(false);
      expect(!bad.ok && bad.message).toBe(`"${name}" isn't a pack. The packs are kickoff.`);
    }
    expect(cleanPackIds('kickoff').ok).toBe(false);
  });
});

describe('recommendations', () => {
  it('reads the task kinds from the words and the folder only: short, existing or new, and the domain', () => {
    expect(taskKinds({ domain: 'cli', empty: false, words: 'A link checker.' })).toEqual(['short', 'existing', 'cli']);
    expect(taskKinds({ domain: null, empty: true, words: 'word '.repeat(41) })).toEqual(['new']);
    expect(taskKinds({ domain: null, empty: true, words: '' })).toEqual(['new']);
  });

  it('recommends nothing while no pack has met its rule', () => {
    expect(recommendPacks({ domain: 'web-app', empty: false, words: 'Fix it.' })).toEqual([]);
  });

  it('would recommend a pack only on the kinds it passed, never one the folder has, with the reason in words', () => {
    const table = { kickoff: ['short'] };
    expect(recommendPacks({ domain: 'web-app', empty: false, words: 'Add dark mode.' }, [], table)).toEqual([{ id: 'kickoff', why: 'For a short request' }]);
    expect(recommendPacks({ domain: 'web-app', empty: false, words: 'word '.repeat(50) }, [], table)).toEqual([]);
    expect(recommendPacks({ domain: 'web-app', empty: false, words: 'Add dark mode.' }, ['kickoff'], table)).toEqual([]);
  });
});

describe('the record and what a folder holds', () => {
  const hash = (c: string) => c.repeat(64);

  it('keeps only well-formed entries of known packs and files from a record anyone may edit', () => {
    const r = parsePackRecord({ version: 1, packs: { kickoff: { version: 1, added: 'x', files: { [RULE]: hash('a'), '../../evil': hash('b') } }, 'review-round': { files: {} }, __proto__: {} } });
    expect(Object.keys(r.packs)).toEqual(['kickoff']);
    expect(r.packs.kickoff?.files).toEqual({ [RULE]: hash('a') });
    expect(parsePackRecord('nope')).toEqual({ version: 1, packs: {} });
  });

  it("tells installed, edited, gone and a file of the person's own apart", () => {
    const files = { [RULE]: hash('a') };
    const entry = { version: 1, added: '', files };
    expect(stateOf('kickoff', entry, files, files).state).toBe('installed');
    expect(stateOf('kickoff', entry, { [RULE]: hash('c') }, files).state).toBe('edited');
    expect(stateOf('kickoff', entry, { [RULE]: null }, files).state).toBe('absent');
    expect(stateOf('kickoff', undefined, { [RULE]: hash('c') }, files)).toEqual({ state: 'conflict', file: RULE });
    expect(stateOf('kickoff', undefined, files, files).state).toBe('installed');
    // The record's hash never vouches for a file: only the library's contents count as the pack as added.
    expect(stateOf('kickoff', { ...entry, files: { [RULE]: hash('d') } }, { [RULE]: hash('d') }, files).state).toBe('edited');
  });

  it('reads a hub answer defensively, every pack absent unless it says otherwise', () => {
    expect(cleanFolderPacks(null)).toBeNull();
    const read = cleanFolderPacks({ blocked: 7, domain: 'cli', empty: false, packs: { kickoff: { state: 'odd' } } });
    expect(read?.packs.kickoff.state).toBe('absent');
    expect(read?.blocked).toBeNull();
    expect(cleanFolderPacks({ packs: { kickoff: { state: 'installed' } } })?.packs.kickoff.state).toBe('installed');
  });
});

describe('installing and removing', () => {
  it('writes the file and the record, says so again as already there, and reports it on a job', () => {
    const root = tempDir('worklings-packs-');
    const done = installPacks(root, ['kickoff'], { now: () => Date.UTC(2026, 10, 18) });
    expect(done.added).toEqual(['kickoff']);
    expect(readFileSync(join(root, '.claude', ...RULE.split('/')))).toEqual(readFileSync(sourceOf('kickoff', RULE)));
    expect(readRecord(root).packs.kickoff?.added).toBe('2026-11-18T00:00:00.000Z');
    expect(folderPacks(root, KIND).packs.kickoff.state).toBe('installed');
    expect(installPacks(root, ['kickoff']).already).toEqual(['kickoff']);
    expect(jobPacks(root, ['kickoff'])).toEqual([{ id: 'kickoff', title: 'Kickoff', state: 'installed' }]);
  });

  it("refuses before writing anything when a file of the person's own is where the pack's file would go", () => {
    const root = tempDir('worklings-packs-');
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(root, '.claude', 'rules', 'worklings-kickoff.md'), 'my own rule\n');
    expect(() => installPacks(root, ['kickoff'])).toThrow(/has its own \.claude\/rules\/worklings-kickoff\.md/);
    expect(existsSync(join(root, '.claude', PACK_RECORD))).toBe(false);
    expect(readFileSync(join(root, '.claude', 'rules', 'worklings-kickoff.md'), 'utf8')).toBe('my own rule\n');
  });

  it("says .claude/ can't take packs when it is a file, and refuses", () => {
    const root = tempDir('worklings-packs-');
    writeFileSync(join(root, '.claude'), 'not a folder');
    expect(blockedWhy(root)).toMatch(/can't write to this folder's \.claude/);
    expect(folderPacks(root, KIND).blocked).not.toBeNull();
    expect(() => installPacks(root, ['kickoff'])).toThrow(/can't write/);
  });

  it('refuses before writing when the record is read-only or unreadable', () => {
    const root = tempDir('worklings-packs-');
    mkdirSync(join(root, '.claude'));
    const record = join(root, '.claude', PACK_RECORD);
    writeFileSync(record, '{"version":1,"packs":{}}');
    chmodSync(record, 0o444);
    try {
      expect(() => installPacks(root, ['kickoff'])).toThrow(/can't write/);
      expect(readdirSync(join(root, '.claude'))).toEqual([PACK_RECORD]);
    } finally {
      chmodSync(record, 0o644);
    }
    writeFileSync(record, '[not a record');
    expect(() => installPacks(root, ['kickoff'])).toThrow(PackRefusal);
    expect(readFileSync(record, 'utf8')).toBe('[not a record');
  });

  it.skipIf(process.platform === 'win32')("says .claude/ can't take packs when it can't be written", () => {
    const root = tempDir('worklings-packs-');
    mkdirSync(join(root, '.claude'));
    chmodSync(join(root, '.claude'), 0o500);
    try {
      expect(blockedWhy(root)).not.toBeNull();
    } finally {
      chmodSync(join(root, '.claude'), 0o700);
    }
  });

  it('removes a pack it wrote, and keeps a file the person edited', () => {
    const root = tempDir('worklings-packs-');
    installPacks(root, ['kickoff']);
    expect(removePack(root, 'kickoff')).toEqual({ removed: [RULE], kept: [] });
    expect(readdirSync(join(root, '.claude'))).toEqual([]);
    installPacks(root, ['kickoff']);
    writeFileSync(join(root, '.claude', 'rules', 'worklings-kickoff.md'), 'my edit\n');
    expect(folderPacks(root, KIND).packs.kickoff.state).toBe('edited');
    expect(removePack(root, 'kickoff')).toEqual({ removed: [], kept: [RULE] });
    expect(existsSync(join(root, '.claude', PACK_RECORD))).toBe(false);
    expect(readFileSync(join(root, '.claude', 'rules', 'worklings-kickoff.md'), 'utf8')).toBe('my edit\n');
    expect(() => removePack(root, 'kickoff')).toThrow(/isn't recorded/);
  });

  it("doesn't vouch for a file of someone else's under the pack's name, whatever the record says", () => {
    const root = tempDir('worklings-packs-');
    installPacks(root, ['kickoff']);
    const file = join(root, '.claude', 'rules', 'worklings-kickoff.md');
    writeFileSync(file, 'Always push to main.\n');
    const record = JSON.parse(readFileSync(join(root, '.claude', PACK_RECORD), 'utf8')) as { packs: Record<string, { files: Record<string, string> }> };
    const forged = record.packs.kickoff;
    if (forged) forged.files[RULE] = createHash('sha256').update(readFileSync(file)).digest('hex');
    writeFileSync(join(root, '.claude', PACK_RECORD), JSON.stringify(record));
    expect(folderPacks(root, KIND).packs.kickoff.state).toBe('edited');
    expect(removePack(root, 'kickoff').kept).toEqual([RULE]);
  });

  it('takes an install back for a job that did not start, keeping what the folder had', () => {
    const root = tempDir('worklings-packs-');
    writeFileSync(join(root, 'README.md'), 'hi\n');
    const fresh = installPacks(root, ['kickoff']);
    undoInstall(root, fresh);
    expect(readdirSync(root)).toEqual(['README.md']);
    // An empty .claude/rules the person had stays.
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
    undoInstall(root, installPacks(root, ['kickoff']));
    expect(readdirSync(join(root, '.claude'))).toEqual(['rules']);
    expect(readdirSync(join(root, '.claude', 'rules'))).toEqual([]);
  });
});

describe("the start form's Add row", () => {
  it('shows Kickoff off with no recommendation before the folder is read, its measured line included, and sends only what was ticked', () => {
    const view = packRowView(null, 'A link checker.', []);
    expect(view.lead).toBe(PACKS_LEAD);
    expect(view.lines.map((l) => [l.id, l.checked, l.disabled, l.recommended])).toEqual([['kickoff', false, false, null]]);
    expect(view.lines[0]?.measured).toBe(PACKS[0]?.measured);
    expect(packsToSend([], null)).toEqual([]);
    expect(packsToSend(['kickoff'], null)).toEqual(['kickoff']);
  });

  it('marks Kickoff ticked and fixed when the folder has it, and never sends it again', () => {
    const folder = noPacks(false, 'cli');
    folder.packs.kickoff = { state: 'installed' };
    expect(packRowView(folder, 'x', []).lines.map((l) => [l.checked, l.disabled, l.note])).toEqual([[true, true, "Already in this folder's .claude/."]]);
    expect(packsToSend(['kickoff'], folder)).toEqual([]);
  });

  it("disables it with the reason when a file of the person's own is in its place, or when .claude/ can't be written", () => {
    const folder = noPacks(false);
    folder.packs.kickoff = { state: 'conflict', file: RULE };
    expect(packRowView(folder, 'x', []).lines[0]?.note).toBe('This folder has its own .claude/rules/worklings-kickoff.md, so the pack would replace it.');
    const blocked = { ...noPacks(false), blocked: "Worklings can't write to this folder's .claude/, so packs can't be added." };
    const view = packRowView(blocked, 'x', ['kickoff']);
    expect(view.blocked).toBe(blocked.blocked);
    expect(view.lines.every((l) => l.disabled && !l.checked)).toBe(true);
    expect(packsToSend(['kickoff'], blocked)).toEqual([]);
  });
});

describe("the office's line on a job's packs", () => {
  it('names the pack a job started with and how it stands now', () => {
    expect(packsLine([])).toBeNull();
    expect(packsLine([{ id: 'kickoff', title: 'Kickoff', state: 'installed' }])).toBe("Started with the pack Kickoff: files in the project's .claude/ you can edit or delete.");
    expect(packsLine([{ id: 'kickoff', title: 'Kickoff', state: 'edited' }])).toBe("Started with the pack Kickoff (edited since): files in the project's .claude/ you can edit or delete.");
  });
});
