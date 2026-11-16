import { describe, expect, it } from 'vitest';
import { changedLine, diffFailedLine, fileCounts, fileCountsSaid, moreCommand, moreLines, parseDiff, unquotePath } from '../web/src/company/tasks/diffModel.ts';

const SHOW = `commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678
Author: Kai <kai@worklings.local>
Date:   Thu Nov 5 14:20:00 2026 +0100

    Build the streak card

diff --git a/src/streak/Card.tsx b/src/streak/Card.tsx
index 83db48f..bf269f4 100644
--- a/src/streak/Card.tsx
+++ b/src/streak/Card.tsx
@@ -10,4 +10,5 @@ export function Card() {
   const days = useStreak();
-  return <p>{days}</p>;
+  return (
+    <p className="streak">{days} days</p>
   );
 }
\\ No newline at end of file
diff --git a/src/streak/new.ts b/src/streak/new.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/streak/new.ts
@@ -0,0 +1,2 @@
+export const STREAK = 1;
+export const MAX = 7;
diff --git a/public/logo.png b/public/logo.png
index 1234567..89abcde 100644
Binary files a/public/logo.png and b/public/logo.png differ
diff --git a/old name.md b/new name.md
similarity index 100%
rename from old name.md
rename to new name.md
`;

describe('reading a diff', () => {
  it('reads files, numbered lines and counts from git show, skipping the commit header', () => {
    const diff = parseDiff(SHOW);
    expect(diff.files.map((f) => [f.path, f.change, f.binary, f.added, f.removed])).toEqual([
      ['src/streak/Card.tsx', 'modified', false, 2, 1],
      ['src/streak/new.ts', 'added', false, 2, 0],
      ['public/logo.png', 'modified', true, 0, 0],
      ['new name.md', 'renamed', false, 0, 0],
    ]);
    expect(diff.files[3]?.from).toBe('old name.md');
    expect(diff.added).toBe(4);
    expect(diff.removed).toBe(1);
    expect(diff.files[0]?.lines.map((l) => [l.kind, l.old, l.new, l.text])).toEqual([
      ['hunk', null, null, '@@ -10,4 +10,5 @@ export function Card() {'],
      ['ctx', 10, 10, '  const days = useStreak();'],
      ['del', 11, null, '  return <p>{days}</p>;'],
      ['add', null, 11, '  return ('],
      ['add', null, 12, '    <p className="streak">{days} days</p>'],
      ['ctx', 12, 13, '  );'],
      ['ctx', 13, 14, '}'],
      ['note', null, null, 'No newline at end of file'],
    ]);
  });

  it('shows 500 lines a file and counts the rest, with the command that shows it whole', () => {
    const body = Array.from({ length: 912 }, (_, i) => `+line ${i}`).join('\n');
    const diff = parseDiff(`diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts\n+++ b/src/big.ts\n@@ -0,0 +1,912 @@\n${body}\n`);
    const file = diff.files[0]!;
    expect(file.lines).toHaveLength(500);
    expect(file.more).toBe(413);
    expect(file.added).toBe(912);
    expect(moreLines(file)).toBe('413 more lines:');
    expect(moreCommand(file, 'a1b2c3d4e5f6')).toBe('git show a1b2c3d -- src/big.ts');
    expect(moreCommand({ path: 'docs/my notes.md' }, 'a1b2c3d')).toBe('git show a1b2c3d -- "docs/my notes.md"');
  });

  it('cuts a very long line so it can’t fill the page', () => {
    const diff = parseDiff(`diff --git a/min.js b/min.js\n--- a/min.js\n+++ b/min.js\n@@ -1 +1 @@\n+${'x'.repeat(5000)}\n`);
    expect(diff.files[0]?.lines[1]?.text).toHaveLength(1000);
  });

  it('reads quoted paths with escaped bytes', () => {
    expect(unquotePath('"caf\\303\\251 menu.md"')).toBe('café menu.md');
    const diff = parseDiff('diff --git "a/caf\\303\\251.md" "b/caf\\303\\251.md"\n--- "a/caf\\303\\251.md"\n+++ "b/caf\\303\\251.md"\n@@ -1 +1 @@\n-a\n+b\n');
    expect(diff.files[0]?.path).toBe('café.md');
  });

  it('reads an empty diff as no files', () => {
    expect(parseDiff('').files).toEqual([]);
    expect(parseDiff('commit abc\n\n    Nothing\n').files).toEqual([]);
  });
});

describe('the words around a diff', () => {
  it('sums up what changed in a sentence', () => {
    const diff = parseDiff(SHOW);
    expect(changedLine(diff, 'a1b2c3d4e5f6', 'worklings/plant-pal')).toBe('4 files, 4 lines added and 1 removed, in a1b2c3d on worklings/plant-pal.');
    expect(changedLine({ files: [diff.files[2]!], added: 0, removed: 0 }, 'a1b2c3d', null)).toBe('1 file, in a1b2c3d.');
    expect(changedLine({ files: [diff.files[1]!], added: 1, removed: 0 }, 'a1b2c3d', null)).toBe('1 file, 1 line added, in a1b2c3d.');
  });

  it('gives each file its counts, in signs and in words', () => {
    const [card, , logo, renamed] = parseDiff(SHOW).files;
    expect(fileCounts(card!)).toBe('+2 −1');
    expect(fileCountsSaid(card!)).toBe('2 lines added, 1 removed');
    expect(fileCounts(logo!)).toBe('Binary file');
    expect(fileCounts(renamed!)).toBe('Renamed');
  });

  it('says why the diff couldn’t be read from git’s first line', () => {
    expect(diffFailedLine('fatal: bad object a1b2c3d\nmore')).toBe("Couldn't read the diff: fatal: bad object a1b2c3d.");
    expect(diffFailedLine('')).toBe("Couldn't read the diff: the office sent nothing back.");
  });
});
