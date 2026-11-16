// Builds the office's art from the CC0 packs, which stay outside the repo: `node scripts/art/build.mjs`.
// WORKLINGS_ART_RAW names the folder that holds the raw packs (CREDITS.md says where each comes from); the GLBs go to
// web/public/art. What each file holds is in web/src/scene/art/spec.ts, the packs and their licences in CREDITS.md.
import { fileURLToPath } from 'node:url';
import { buildArt } from './pipeline.ts';

const raw = process.env.WORKLINGS_ART_RAW;
if (!raw) {
  console.error('Set WORKLINGS_ART_RAW to the folder that holds the raw CC0 packs (CREDITS.md lists them and where to get each).');
  process.exit(1);
}
const out = fileURLToPath(new URL('../../web/public/art/', import.meta.url));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const table = (rows) => {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => String(row[i]).length)));
  return rows.map((row) => row.map((cell, i) => (i === 0 || i === row.length - 1 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]))).join('  ').trimEnd()).join('\n');
};

try {
  const report = await buildArt(raw, out);
  const total = report.files.reduce((sum, f) => sum + f.bytes, 0);
  console.log(
    table([
      ['File', 'Size', 'Triangles', 'Contents'],
      ...report.files.map((f) => [f.file, kb(f.bytes), f.triangles === null ? '' : f.triangles.toLocaleString('en-GB'), f.contents]),
      ['Total', kb(total), '', `${report.files.length} files`],
    ]),
  );
  console.log();
  console.log(
    table([
      ['Clip', 'Seconds', 'Tracks', 'From'],
      ...report.clips.map((c) => [c.name, c.seconds.toFixed(2), c.before ? `${c.before} -> ${c.tracks}` : String(c.tracks), c.from]),
    ]),
  );
  console.log();
  for (const note of report.notes) console.log(`- ${note}`);
} catch (error) {
  console.error(`The art build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
