// Proves Catch me up and Ask aside end to end against the real Claude Code: a throwaway project with a generated
// studio, a live office from source, a real Haiku session that briefs a subagent, then one question to the lead (a
// fork), one to its subagent (from its transcript) and one catch-up, all through the office's own endpoints. Checks
// that the fork left the lead's transcript as it was and no transcript behind. Spends a few cents of Haiku.
//
//   node scripts/check-aside.mjs [--port 4393] [--keep]
//
// Writes test-results/aside-check.json. Run it again when Claude Code changes (see docs/claude-code-surfaces.md).
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const port = Number(args[args.indexOf('--port') + 1] ?? 4393) || 4393;
/** WORKLINGS_CLAUDE's name before the rename: read when the new one is unset or empty, as the office does. */
const LEGACY_CLAUDE_VARIABLE = 'HEADCOUNT_CLAUDE';
const claude = process.env.WORKLINGS_CLAUDE || process.env[LEGACY_CLAUDE_VARIABLE] || 'claude';
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const env = { ...process.env };
delete env.CLAUDECODE;
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const project = mkdtempSync(join(tmpdir(), 'worklings-aside-check-'));
const home = mkdtempSync(join(tmpdir(), 'worklings-aside-home-'));
const token = randomBytes(24).toString('base64url');
mkdirSync(join(home, '.worklings'), { recursive: true });
writeFileSync(join(home, '.worklings', 'token'), `${token}\n`, { mode: 0o600 });
// The office makes its working folder in the system temp folder; point that at one this script removes, since
// killing the office on Windows skips its own cleanup.
const officeTemp = mkdtempSync(join(tmpdir(), 'worklings-aside-temp-'));
const officeEnv = { ...env, WORKLINGS_HOME: home, TEMP: officeTemp, TMP: officeTemp, TMPDIR: officeTemp };
const transcripts = join(claudeHome, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
const base = `http://127.0.0.1:${port}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const report = { project, port, steps: {} };
let office = null;

async function state() {
  const res = await fetch(`${base}/api/state`, { headers });
  if (!res.ok) throw new Error(`GET /api/state answered ${res.status}`);
  return res.json();
}

async function until(what, test, ms = 120_000) {
  const start = Date.now();
  for (;;) {
    const s = await state();
    const found = test(s);
    if (found) return found;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await sleep(500);
  }
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

try {
  writeFileSync(join(project, 'add.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
  const cli = (...a) => execFileSync(process.execPath, ['src/cli.ts', ...a], { env: officeEnv, encoding: 'utf8' });
  cli('new', project, '--domain', 'generic', '--idea', 'A tiny maths library');
  cli('hooks', 'install', project, '--port', String(port), '--yes');

  office = spawn(process.execPath, ['src/cli.ts', 'office', project, '--port', String(port), '--no-open'], { env: officeEnv, stdio: 'ignore', windowsHide: true });
  for (let tries = 0; ; tries += 1) {
    try {
      await state();
      break;
    } catch (error) {
      if (tries > 60) throw new Error(`The office did not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await sleep(500);
    }
  }

  // A real session that briefs the studio's code reviewer.
  const session = await new Promise((resolve) => {
    const c = spawn(claude, ['-p', '--model', 'haiku', '--permission-mode', 'acceptEdits', '--output-format', 'json'], { cwd: project, env, shell: false, windowsHide: true });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ raw: out.slice(0, 500) });
      }
    });
    c.stdin.end('Use the code-reviewer subagent to review add.js, then tell me in one sentence what it found.');
  });
  report.steps.session = { result: session.result, costUsd: session.total_cost_usd, sessionId: session.session_id };
  log('session', session.total_cost_usd, String(session.result).slice(0, 120));

  const people = await until('the lead and the code reviewer', (s) => {
    const lead = s.agents.find((a) => a.kind === 'lead' && a.requests > 0);
    const reviewer = s.agents.find((a) => a.roleId === 'code-reviewer' && a.status === 'done');
    return lead && reviewer ? { lead, reviewer } : null;
  });
  const leadFile = join(transcripts, `${people.lead.sessionId}.jsonl`);
  const leadHash = sha(leadFile);
  const before = readdirSync(transcripts).filter((f) => f.endsWith('.jsonl'));

  const ask = async (label, agent, question) => {
    const sent = await post('/api/ask', { agentKey: agent.key, question });
    if (sent.status !== 202) throw new Error(`${label}: POST /api/ask answered ${sent.status} ${JSON.stringify(sent.body)}`);
    const answer = await until(`${label}'s answer`, (s) => s.aside.answers.find((a) => a.id === sent.body.id && a.answeredAt), 90_000);
    report.steps[label] = { question, source: answer.source, text: answer.text, failure: answer.failure, costUsd: answer.cost, tokens: answer.tokens };
    log(label, answer.source, answer.cost, String(answer.text ?? JSON.stringify(answer.failure)).slice(0, 160));
  };
  await ask('askLead', people.lead, 'What are you working on?');
  await ask('askReviewer', people.reviewer, 'What did you find?');

  const caught = await post('/api/catch-up', {});
  if (caught.status !== 202 && caught.status !== 200) throw new Error(`POST /api/catch-up answered ${caught.status}`);
  const digest = caught.status === 200 ? caught.body : await until('the digest', (s) => s.aside.digests.find((d) => d.id === caught.body.id && d.at), 90_000);
  report.steps.catchUp = { source: digest.source, text: digest.text, failure: digest.failure, costUsd: digest.cost, tokens: digest.tokens };
  log('catchUp', digest.source, digest.cost, String(digest.text ?? JSON.stringify(digest.failure)).slice(0, 160));

  const final = await state();
  report.fork = {
    leadTranscriptUnchanged: sha(leadFile) === leadHash,
    leadTranscriptSha256: leadHash,
    transcriptsLeftBehind: readdirSync(transcripts).filter((f) => f.endsWith('.jsonl') && !before.includes(f)),
  };
  report.spend = final.aside.spend;
  report.totals = { cost: final.totals.cost };
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  log('error', report.error);
} finally {
  office?.kill();
  await sleep(500);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/aside-check.json', `${JSON.stringify(report, null, 2)}\n`);
  if (!keep) for (const dir of [project, home, officeTemp, transcripts]) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  log('Wrote test-results/aside-check.json');
}
