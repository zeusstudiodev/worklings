// Plan-only validation (v0.2, SPEC-v0.2.md "Better by design"): what the CEO makes of a prompt, with nothing built. It
// founds a company in a temp folder through a throwaway hub (its own WORKLINGS_HOME and a free port), takes the CEO's
// own picks for its scoping questions, starts the company when the CEO has proposed its org, waits for the CEO's plan,
// prints the org, the plan and what the office's checks sent back, and stops the hub WITHOUT approving the plan, so no
// task starts. The CEO's cost is the only spend (a few cents on Sonnet or Haiku, more on Opus).
//
//   node scripts/plan-only.mjs <prompt file>              [--preset lean|balanced|thorough] [--model sonnet|haiku|opus]
//   node scripts/plan-only.mjs --prompt "<one sentence>"  [--json <file>] [--keep] [--minutes <n>] [--verbose]
//
//   --preset   the stakeholder's spending choice; left out, the default (Balanced) stands, as when nobody answers.
//   --model    ANTHROPIC_MODEL for every desk, so a check can run on Haiku; left out, Sonnet. Opus is the presets' own CEO.
//   --json     also write the report as JSON to this file.
//   --keep     keep the temp project and home (their paths are printed); otherwise they are deleted.
//   --minutes  how long each wait may take (default 15).
//   --verbose  print each refusal in full instead of cut to 300 characters.
//
// Prints: the org (size, its reason, people, models), the plan (tasks with owner, files, check, after, kind), how many
// times the proposal check (org) and the plan check with the plan linter (plan) refused and with which sentences (read
// from <project>/.worklings/refusals.jsonl, which the company writes), and the CEO's cost. Real runs follow
// AGENTS.md: CLAUDECODE is unset for the hub, only the process tree this script started is stopped (by its recorded
// PID), and the company works in a neutral empty folder. With WORKLINGS_CLAUDE pointing at test/fake-desk.mjs (and
// FAKE_DESK_SCRIPT) the whole run is a dry one: test/plan-only.test.ts does that.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const PRESETS = ['lean', 'balanced', 'thorough'];
const MODELS = ['sonnet', 'haiku', 'opus'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const now = () => Date.now();

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write('Usage: node scripts/plan-only.mjs <prompt file | --prompt "text"> [--preset lean|balanced|thorough] [--model sonnet|haiku|opus] [--json file] [--keep] [--minutes n] [--verbose]\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const options = { prompt: null, file: null, preset: null, model: 'sonnet', json: null, keep: false, minutes: 15, verbose: false };
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  const value = () => {
    i += 1;
    if (args[i] === undefined) usage(`${a} needs a value.`);
    return args[i];
  };
  if (a === '--prompt') options.prompt = value();
  else if (a === '--preset') options.preset = value();
  else if (a === '--model') options.model = value();
  else if (a === '--json') options.json = resolve(value());
  else if (a === '--minutes') options.minutes = Number(value());
  else if (a === '--keep') options.keep = true;
  else if (a === '--verbose') options.verbose = true;
  else if (a.startsWith('--')) usage(`Unknown option ${a}.`);
  else if (options.file === null) options.file = a;
  else usage('Give one prompt file, or --prompt.');
}
if (options.preset !== null && !PRESETS.includes(options.preset)) usage(`--preset is one of ${PRESETS.join(', ')}.`);
if (!MODELS.includes(options.model)) usage(`--model is one of ${MODELS.join(', ')}.`);
if (!(options.minutes > 0)) usage('--minutes is a number above 0.');
if ((options.prompt === null) === (options.file === null)) usage('Give a prompt file or --prompt, not both and not neither.');
if (options.file !== null && !existsSync(options.file)) usage(`No prompt file at ${options.file}.`);
const prompt = (options.prompt ?? readFileSync(options.file, 'utf8')).trim().replace(/\s*\n\s*/g, ' ');
if (prompt === '') usage('The prompt is empty.');

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const killTree = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
};

const folder = mkdtempSync(join(tmpdir(), 'plan-only-project-'));
const home = mkdtempSync(join(tmpdir(), 'plan-only-home-'));
const git = (...a) => spawnSync('git', ['-c', 'user.name=plan-only', '-c', 'user.email=plan-only@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: folder, encoding: 'utf8', windowsHide: true });
git('init', '-q', '-b', 'main');
git('commit', '-q', '--allow-empty', '-m', 'Starting point');

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, WORKLINGS_HOME: home, ANTHROPIC_MODEL: options.model };
delete env.CLAUDECODE;
const fake = Boolean(process.env.WORKLINGS_CLAUDE);
process.stderr.write(`plan-only: ${fake ? 'FAKE desk' : 'REAL Claude Code'}; project ${folder}; home ${home}; port ${port}; model ${options.model}; preset ${options.preset ?? 'balanced (default)'}\n`);

const startedAt = now();
const waitMs = options.minutes * 60_000;
let hubExited = false;
const hub = spawn(process.execPath, [join(REPO, 'src', 'cli.ts'), 'new', folder, '--prompt', prompt, '--port', String(port), '--no-open'], {
  cwd: REPO,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
const hubPid = hub.pid;
let hubOutput = '';
hub.on('close', () => {
  hubExited = true;
});
for (const stream of [hub.stdout, hub.stderr]) stream.on('data', (c) => {
  hubOutput = (hubOutput + c).slice(-20_000);
});

let token = null;
const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body: json, text };
};

let companyId = null;
let snapshot = null;
const look = async () => {
  if (!companyId) return null;
  const r = await call('GET', `/api/c/${companyId}/state`).catch(() => null);
  if (!r || r.status !== 200 || !r.body?.company) return null;
  snapshot = r.body;
  return snapshot.company;
};
async function waitFor(what, ok, ms = waitMs) {
  const until = now() + ms;
  while (now() < until) {
    if (hubExited) throw new Error(`the hub exited while waiting for ${what}. Its output:\n${hubOutput.slice(-1500)}`);
    if (await ok()) return;
    await sleep(1_000);
  }
  throw new Error(`gave up waiting for ${what} after ${options.minutes} minutes`);
}

const report = { prompt, preset: options.preset ?? 'balanced', model: options.model, dryRun: fake, org: null, plan: null, refusals: { org: [], plan: [] }, notes: { org: [], plan: [] }, costUsd: null, totalCostUsd: null, failure: null };
try {
  const tokenFile = join(home, '.worklings', 'token');
  await waitFor('the hub to start', async () => {
    if (!token && existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
    if (!token) return false;
    const lobby = await call('GET', '/api/lobby').catch(() => null);
    companyId = lobby?.body?.companies?.[0]?.id ?? null;
    return companyId !== null;
  }, 120_000);

  if (options.preset !== null && options.preset !== 'balanced') {
    const r = await call('POST', `/api/c/${companyId}/preset`, { preset: options.preset });
    if (r.status !== 200) throw new Error(`the hub refused the preset ${options.preset} (${r.status}): ${r.text.slice(0, 300)}`);
  }

  // The CEO scopes first when the prompt leaves choices open; its own picks answer, as an unattended stakeholder would.
  await waitFor('the CEO to propose an org', async () => {
    const company = await look();
    if (!company) return false;
    if (company.phase === 'proposed') return true;
    const round = company.phase === 'founding' ? company.scoping : null;
    if (round && round.answeredAt === null && (company.questions ?? []).some((q) => round.questions.includes(q.id) && !q.answer && !q.withdrawn)) {
      await call('POST', `/api/c/${companyId}/scoping/picks`, {});
    }
    return false;
  });
  const proposed = (await look())?.proposal;
  report.org = {
    size: proposed?.size ?? null,
    sizing: proposed?.sizing ?? null,
    people: (proposed?.people ?? []).map((p) => ({ id: p.id, title: p.title, level: p.level, reportsTo: p.reportsTo, model: p.model })),
  };

  // Start the company so the CEO plans. Plan approval must govern, or the plan would start work the moment it exists.
  const settings = (await look())?.steering?.settings?.planApproval;
  if (settings === 'off') throw new Error('plan approval is off in this company, so a proposed plan would start work at once; plan-only never starts that');
  const started = await call('POST', `/api/c/${companyId}/start`, {});
  if (started.status !== 200) throw new Error(`Start was refused (${started.status}): ${started.text.slice(0, 300)}`);
  await waitFor('the company to run', async () => (await look())?.phase === 'running', 180_000);
  await waitFor('the CEO to propose a plan', async () => ((await look())?.steering?.plan?.versions?.length ?? 0) > 0);

  // The CEO may revise after its first version (a refusal sends it back in the same turn); wait until it has been quiet.
  let quietSince = null;
  while (now() - startedAt < waitMs * 2 && !hubExited) {
    const company = await look();
    const idle = (company?.desks?.working ?? 0) === 0 && (company?.desks?.waiting ?? 0) === 0;
    if (idle) {
      quietSince ??= now();
      if (now() - quietSince >= 4_000) break;
    } else quietSince = null;
    await sleep(1_000);
  }
  const company = await look();
  const versions = company?.steering?.plan?.versions ?? [];
  const latest = versions.at(-1);
  if (company?.steering?.plan?.approved) throw new Error('the plan was approved by something other than this script; nothing is built here, so stopping');
  report.plan = latest
    ? {
        version: latest.version,
        versions: versions.length,
        goal: latest.plan.goal,
        milestones: latest.plan.milestones.map((m) => ({ id: m.id, title: m.title })),
        tasks: latest.plan.tasks.map((t) => ({ id: t.id, title: t.title, owner: t.owner, files: t.files, check: t.check ?? null, after: t.after, kind: t.kind ?? null, milestone: t.milestone })),
        contracts: (latest.plan.contracts ?? []).length,
      }
    : null;
  const ceoPerson = (company?.people ?? []).find((p) => p.level === 'ceo');
  report.costUsd = typeof ceoPerson?.cost === 'number' ? ceoPerson.cost : (snapshot?.totals?.cost ?? null);
  report.totalCostUsd = snapshot?.totals?.cost ?? null;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
}

// What the office turned down, as the company recorded it.
const refusalsFile = join(folder, '.worklings', 'refusals.jsonl');
if (existsSync(refusalsFile)) {
  for (const line of readFileSync(refusalsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      // A note is what the office changed in a proposal or plan it accepted (cut text, a final review added): not a refusal.
      if ((r.kind === 'org' || r.kind === 'plan') && r.note === true) report.notes[r.kind].push({ at: r.at, notes: r.notes });
      else if (r.kind === 'org' || r.kind === 'plan') report.refusals[r.kind].push({ at: r.at, count: r.count, errors: r.errors });
    } catch {
      // a half-written last line
    }
  }
}

// Stop the hub we started: gracefully first, then its tree by the recorded PID. Never by port, name or pattern.
spawnSync(process.execPath, [join(REPO, 'src', 'cli.ts'), 'hub', '--stop'], { cwd: REPO, env, encoding: 'utf8', timeout: 90_000, windowsHide: true });
for (let i = 0; i < 40 && !hubExited; i += 1) await sleep(500);
if (!hubExited) killTree(hubPid);
await sleep(500);

const cut = (text) => (options.verbose || text.length <= 300 ? text : `${text.slice(0, 299)}…`);
const out = [];
const line = (text = '') => out.push(text);
line(`Prompt: ${prompt}`);
line(`Preset ${report.preset}, model ${report.model}${fake ? ' (dry run with a fake desk)' : ''}.`);
line();
line('ORG');
if (report.org) {
  line(`  size: ${report.org.size ?? '(none)'}`);
  line(`  why: ${report.org.sizing ?? '(none)'}`);
  const makers = report.org.people.filter((p) => p.level === 'worker').length;
  line(`  ${report.org.people.length} people, ${makers} at level worker`);
  for (const p of report.org.people) line(`  - ${p.id} (${p.title}, ${p.level}, ${p.model}) reports to ${p.reportsTo ?? 'the stakeholder'}`);
} else line('  (the CEO proposed no org)');
line();
line('PLAN');
if (report.plan) {
  line(`  version ${report.plan.version} of ${report.plan.versions}, ${report.plan.tasks.length} tasks in ${report.plan.milestones.length} milestones, ${report.plan.contracts} contracts`);
  for (const t of report.plan.tasks) {
    line(`  ${t.id} [${t.milestone}] ${t.title}`);
    line(`      owner ${t.owner}; files ${t.files.length > 0 ? t.files.join(', ') : '(none)'}; after ${t.after.length > 0 ? t.after.join(', ') : '(nothing)'}; kind ${t.kind ?? 'part'}`);
    line(`      check: ${t.check ?? '(none)'}`);
  }
} else line('  (the CEO proposed no plan)');
line();
for (const [kind, label] of [['org', 'proposal check (org)'], ['plan', 'plan check and linter (plan)']]) {
  const list = report.refusals[kind];
  line(`REFUSED by the ${label}: ${list.length} time${list.length === 1 ? '' : 's'}`);
  list.forEach((r, i) => {
    line(`  round ${i + 1}: ${r.count} problem${r.count === 1 ? '' : 's'}`);
    for (const e of r.errors) line(`    - ${cut(e)}`);
  });
  for (const n of report.notes[kind]) for (const e of n.notes) line(`  note: ${cut(e)}`);
}
line();
line(`CEO cost: ${report.costUsd === null ? 'unknown' : `$${report.costUsd.toFixed(4)}`}${report.totalCostUsd !== null && report.totalCostUsd !== report.costUsd ? ` (the company's whole spend $${report.totalCostUsd.toFixed(4)})` : ''}`);
line(`Plan approved: no. Nothing was built.${options.keep ? ` Kept: ${folder} and ${home}.` : ''}`);
if (report.failure) line(`FAILED: ${report.failure}`);
process.stdout.write(`${out.join('\n')}\n`);
if (options.json) writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);

if (!options.keep) {
  for (const dir of [folder, home]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    } catch {
      process.stderr.write(`Couldn't remove ${dir}; delete it yourself.\n`);
    }
  }
}
process.exit(report.failure ? 1 : 0);
