// Points every link to Worklings' home at the one in scripts/home.json: the GitHub repository (github.com/<owner>/
// worklings, `marketplace add <owner>/worklings`, `gh ... <owner>/worklings`) and the demo (<owner>.github.io/worklings).
//   node scripts/set-home.mjs              rewrite the tracked text files, the internal run logs left as they are
//   node scripts/set-home.mjs --dry-run    list what would change
// Then `npm run check:public` confirms that nothing points elsewhere.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = JSON.parse(readFileSync(join(root, 'scripts', 'home.json'), 'utf8'));
const [owner, name] = String(home.repository).split('/');
if (!owner || name !== 'worklings') throw new Error(`scripts/home.json: repository must be "<owner>/worklings", not "${home.repository}".`);
const demoHost = new URL(home.demo).host;
const dry = process.argv.includes('--dry-run');

const RULES = [
  [/github\.com\/[\w.-]+\/worklings\b/g, `github.com/${owner}/worklings`],
  [/\b[\w-]+\.github\.io\/worklings\b/g, `${demoHost}/worklings`],
  [/(marketplace add )[\w.-]+\/worklings\b/g, `$1${owner}/worklings`],
  [/(--repo |--marketplace |repos\/|gh repo (?:create|view|edit) |`)[\w.-]+\/worklings\b/g, `$1${owner}/worklings`],
  [/(img\.shields\.io\/github\/[\w-]+\/)[\w.-]+\/worklings\b/g, `$1${owner}/worklings`],
];

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !f.startsWith('.claude/runs/') && f !== 'scripts/set-home.mjs');
let changed = 0;
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(join(root, file));
  } catch {
    continue;
  }
  if (buf.subarray(0, 8000).includes(0)) continue;
  const before = buf.toString('utf8');
  const after = RULES.reduce((text, [re, to]) => text.replace(re, to), before);
  if (after === before) continue;
  changed++;
  console.log(`${dry ? 'would change' : 'changed'} ${file}`);
  if (!dry) writeFileSync(join(root, file), after);
}
console.log(`${changed} file(s) ${dry ? 'would point' : 'now point'} at ${home.repository} and ${home.demo}.`);
