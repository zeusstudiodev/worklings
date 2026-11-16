// Arm B of the benchmark: a Worklings company founded from the same goal, run through a throwaway hub.
//
//   node scripts/bench/run-b.mjs <task> <out>
//
// What it does, through the hub's own HTTP API as the browser would: `worklings new <folder> --prompt "<goal>"` in a
// hub with its own WORKLINGS_HOME and a free port; answers the CEO's scoping questions, when it asks any before drafting,
// with the CEO's own picks (one press of "Use the CEO's picks", as an unattended stakeholder would; result.json says how
// many there were in `scoping`); waits for the CEO's proposal; takes it as it is (except that a model
// the benchmark's BENCH_MODEL doesn't name as the top one, i.e. "opus", becomes BENCH_MODEL, so both arms run the same
// model); caps desks at 3 (BENCH_DESKS); starts the company; approves the plan as the CEO proposed it (and any later
// version of it); answers what blocks the company so it never waits for a person (see below); waits until the company
// says its work is done or the wall-time cap passes; stops the hub; saves everything.
//
// Everything the harness did on the company's behalf is an "intervention" and is counted in result.json and written to
// events.jsonl: the plan approvals, model changes, approvals answered (allow only for kind "other"; every other kind is
// denied with a note that says to carry on without it) and questions answered (the CEO's recommended option, else the
// first, else "use your best judgment"). The plan wants zero after the plan's approval; if the number isn't zero,
// the report says so. Model changes are recorded but left out of the total: they are the benchmark's own setup (one
// model for every arm), not a person stepping in, and from v0.2 the proposal puts the CEO on Opus by default.
// The office's own "How thorough?" question (v0.2, `preset: true`) is left to its default, as an unattended
// stakeholder would leave it: it blocks nothing, and the office withdraws it at the start. It isn't counted in
// questionsAsked, which counts the questions the company's people ask.
//
// "Done" is the company's own: it marks its plan finished (`done` in its view) once every task is done or dropped,
// every milestone is done and nothing waits to be committed or approved, and tells the CEO to report. The harness then
// waits until nobody is working or waiting for a desk and nothing waits in the inbox for BENCH_QUIET_S seconds (default
// 90), so the CEO's last report is in the run. A company that never gets there is stopped at the cap and marked capped;
// when its desks were all idle with tasks still open at the cap, result.json says since when ("stalled since <time>").
//
// Environment: as run-a.mjs (BENCH_ROOT, BENCH_MODEL, BENCH_MINUTES, WORKLINGS_CLAUDE, BENCH_FORCE), plus
//   BENCH_PRODUCT (a frozen copy of the Worklings to run, see lib.mjs's PRODUCT; result.json records its commit),
//   BENCH_DESKS (default 3), BENCH_QUIET_S (default 90), BENCH_PROPOSAL_S (how long the CEO may take to propose, default 600),
//   FAKE_DESK_SCRIPT (a dry run's script for test/fake-desk.mjs; the dry run sets it, a real run never does)
// Saves to <out>: result.json, events.jsonl (what the harness did), state.json (the company's last snapshot), ledger.json
// (spend and tokens), decisions.json, log.json, tasks.json, hub.log, project/ (the company's folder, without node_modules).
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MACHINE_KILL } from './kill-guard.mjs';
import { claudeCommand, copyTree, environment, freePort, goalOf, killTree, leftovers, MINUTES, MODEL, now, outDir, prepareStart, PRODUCT, removeTree, REPO, requireTask, sh, sleep, stepInsOf, tail, writeJson } from './lib.mjs';

const task = requireTask(process.argv[2]);
const out = outDir(process.argv[3], 'result.json');
const goal = goalOf(task);
const DESKS = Number(process.env.BENCH_DESKS) > 0 ? Number(process.env.BENCH_DESKS) : 3;
const QUIET_MS = (Number(process.env.BENCH_QUIET_S) > 0 ? Number(process.env.BENCH_QUIET_S) : 90) * 1000;
const PROPOSAL_MS = (Number(process.env.BENCH_PROPOSAL_S) > 0 ? Number(process.env.BENCH_PROPOSAL_S) : 600) * 1000;
const POLL_MS = 2_000;
const { fake } = claudeCommand();

writeFileSync(join(out, 'goal.txt'), `${goal}\n`);
const events = join(out, 'events.jsonl');
const interventions = { planApprovals: 0, modelChanges: 0, approvalsAllowed: 0, approvalsDenied: 0, questionsAnswered: 0 };
const note = (kind, detail = {}) => appendFileSync(events, `${JSON.stringify({ at: new Date().toISOString(), kind, ...detail })}\n`);

const folder = prepareStart(task, 'bench-b');
const home = mkdtempSync(join(tmpdir(), 'bench-b-home-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
// v0.6 (E1): BENCH_SEAT_MODELS="reviewer=opus" keeps those seats on their own model. ANTHROPIC_MODEL would run everyone, so
// it is left unset then, and every other person's model is set to BENCH_MODEL in the proposal instead (the Lead's founding
// turn, before the proposal exists, runs on the preset's Lead model).
const SEAT_MODELS = Object.fromEntries((process.env.BENCH_SEAT_MODELS ?? '').split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2 && p[0] && p[1]));
const env = { ...process.env, WORKLINGS_HOME: home, ...(Object.keys(SEAT_MODELS).length > 0 ? {} : { ANTHROPIC_MODEL: MODEL }) };
if (Object.keys(SEAT_MODELS).length > 0) delete env.ANTHROPIC_MODEL;
delete env.CLAUDECODE;
console.log(`arm B, ${task}: ${fake ? `FAKE claude (${process.env.WORKLINGS_CLAUDE})` : 'REAL claude'}; company in ${folder}; hub on port ${port} (home ${home}); cap ${MINUTES} min, model ${MODEL}, desks ${DESKS}`);

// --- the hub -----------------------------------------------------------------------------------------------------------
const startedAt = now();
const hubLog = join(out, 'hub.log');
writeFileSync(hubLog, '');
const hub = spawn(process.execPath, [join(PRODUCT, 'src', 'cli.ts'), 'new', folder, '--prompt', goal, '--port', String(port), '--no-open'], { cwd: PRODUCT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const hubPid = hub.pid;
let hubExited = false;
hub.on('close', (code) => {
  hubExited = true;
  note('hub-exited', { code });
});
hub.stdout.on('data', (c) => appendFileSync(hubLog, c));
hub.stderr.on('data', (c) => appendFileSync(hubLog, c));
note('hub-started', { pid: hubPid, port });

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

// Which Worklings ran: the frozen copy's PRODUCT_COMMIT, else this repo's HEAD (and whether its tree had changes).
const productCommit = existsSync(join(PRODUCT, 'PRODUCT_COMMIT'))
  ? readFileSync(join(PRODUCT, 'PRODUCT_COMMIT'), 'utf8').trim()
  : `${sh('git', ['rev-parse', '--short', 'HEAD'], { cwd: PRODUCT, timeoutMs: 20_000 }).stdout.trim()}${sh('git', ['status', '--porcelain', '--', 'src', 'library'], { cwd: PRODUCT, timeoutMs: 20_000 }).stdout.trim() ? ' (with uncommitted changes)' : ''}`;
const result = {
  task, arm: 'B', dryRun: fake, model: MODEL, desks: DESKS, startedAt: new Date(startedAt).toISOString(), hubPid, port, interventions, done: false, doneReason: null, capped: false,
  product: { frozen: PRODUCT !== REPO, commit: productCommit },
};
let company = null;
let companyId = null;
let snapshot = null;
const capAt = startedAt + MINUTES * 60_000;

/** The company's current snapshot; null while the hub doesn't answer. */
async function look() {
  if (!companyId) return null;
  const r = await call('GET', `/api/c/${companyId}/state`).catch(() => null);
  if (!r || r.status !== 200 || !r.body?.company) return null;
  snapshot = r.body;
  company = r.body.company;
  return company;
}

async function waitFor(what, ok, ms) {
  const until = Math.min(now() + ms, capAt);
  while (now() < until) {
    if (hubExited) throw new Error(`the hub exited while waiting for ${what}`);
    if (await ok()) return true;
    await sleep(POLL_MS);
  }
  return false;
}

let failure = null;
try {
  // The token appears once the hub has started; the company a moment later.
  const tokenFile = join(home, '.worklings', 'token');
  if (!(await waitFor('the hub to start', async () => {
    if (!token && existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
    if (!token) return false;
    const lobby = await call('GET', '/api/lobby').catch(() => null);
    companyId = lobby?.body?.companies?.[0]?.id ?? null;
    return companyId !== null;
  }, 120_000))) throw new Error(`the hub never showed a company. Hub output:\n${tail(readFileSync(hubLog, 'utf8'), 20)}`);
  note('company-founded', { id: companyId });

  // 1. The CEO scopes the goal with a few questions when it wants to, then drafts the org: answer the questions with its
  // own picks, as an unattended stakeholder would, and wait for its proposal.
  const scopingPicks = async () => {
    const round = company?.phase === 'founding' ? company.scoping : null;
    if (!round || round.answeredAt !== null) return;
    const open = (company.questions ?? []).filter((q) => round.questions.includes(q.id) && !q.answer && !q.withdrawn);
    if (open.length === 0) return;
    const r = await call('POST', `/api/c/${companyId}/scoping/picks`, {});
    result.scoping = { questions: round.questions.length, answeredWith: 'the CEO\'s picks', askedAfterMs: Math.max(0, round.askedAt - startedAt), status: r.status };
    note('scoping-answered', {
      questions: open.map((q) => ({ id: q.id, text: String(q.text).slice(0, 300), options: q.options, pick: q.recommended, why: q.why ?? null })),
      status: r.status,
      text: r.status === 200 ? undefined : r.text.slice(0, 200),
    });
  };
  result.scoping = { questions: 0, answeredWith: null };
  if (!(await waitFor('the CEO proposal', async () => {
    if ((await look())?.phase === 'proposed') return true;
    await scopingPicks();
    return false;
  }, PROPOSAL_MS))) {
    throw new Error(`no proposal from the CEO: phase ${company?.phase ?? 'unknown'}, drafting ${JSON.stringify(company?.drafting ?? null)}`);
  }
  result.proposalAfterMs = now() - startedAt;
  note('proposal', { people: company.proposal?.people?.map((p) => `${p.id}:${p.model}`), sizing: company.proposal?.sizing ?? null });
  result.proposal = { people: company.proposal?.people?.length ?? 0, sizing: company.proposal?.sizing ?? null };

  // 2. Take it as it is, with the benchmark's model for anyone it gave Opus; desks capped.
  const proposal = structuredClone(company.proposal);
  const changed = [];
  for (const p of proposal.people) {
    if (Object.hasOwn(SEAT_MODELS, p.id)) {
      if (p.model !== SEAT_MODELS[p.id]) {
        changed.push(`${p.id}: ${p.model} -> ${SEAT_MODELS[p.id]}`);
        p.model = SEAT_MODELS[p.id];
      }
    } else if ((Object.keys(SEAT_MODELS).length > 0 && p.model !== MODEL) || (/opus/i.test(String(p.model)) && MODEL !== 'opus')) {
      changed.push(`${p.id}: ${p.model} -> ${MODEL}`);
      p.model = MODEL;
    }
  }
  if (changed.length > 0) {
    const edit = await call('POST', `/api/c/${companyId}/proposal`, { proposal });
    if (edit.status !== 200) throw new Error(`the hub refused the proposal with models changed (${edit.status}): ${edit.text.slice(0, 300)}`);
    interventions.modelChanges = changed.length;
    note('models-changed', { changed });
  }
  const desks = await call('POST', `/api/c/${companyId}/settings`, { maxDesks: DESKS });
  if (desks.status !== 200) throw new Error(`the hub refused maxDesks ${DESKS} (${desks.status}): ${desks.text.slice(0, 300)}`);
  const started = await call('POST', `/api/c/${companyId}/start`, {});
  if (started.status !== 200) throw new Error(`Start was refused (${started.status}): ${started.text.slice(0, 300)}`);
  result.startedWorkAtMs = now() - startedAt;
  note('started', { people: proposal.people.length });
  if (!(await waitFor('the company to run', async () => (await look())?.phase === 'running', 180_000))) throw new Error('the company never reached the running phase');

  // 3. The work: approve the plan, answer what blocks, wait for done.
  let quietSince = null;
  let planApprovedAt = null;
  /** Since when nobody has been at work or waiting for a desk while tasks are open; null while anything moves. */
  let stalledSince = null;
  while (now() < capAt) {
    if (hubExited) throw new Error('the hub exited during the run');
    await look();
    if (company) {
      // The plan: the latest version, approved as proposed.
      const plan = company.steering?.plan;
      const latest = plan?.versions?.at(-1);
      if (latest && plan.approved?.version !== latest.version && company.steering?.settings?.planApproval !== 'off') {
        const r = await call('POST', `/api/c/${companyId}/plan/approve`, { version: latest.version });
        note('plan-approved', { version: latest.version, status: r.status, text: r.status === 200 ? undefined : r.text.slice(0, 200) });
        if (r.status === 200) {
          interventions.planApprovals += 1;
          planApprovedAt ??= now() - startedAt;
        }
      } else if (plan?.approved && planApprovedAt === null) planApprovedAt = now() - startedAt;

      // Questions the company asks the stakeholder.
      for (const q of company.questions ?? []) {
        if (q.answer || q.withdrawn || q.preset === true) continue;
        const option = Number.isInteger(q.recommended) ? q.recommended : q.options?.length > 0 ? 0 : null;
        const body = option === null ? { question: q.id, text: 'Use your best judgment and carry on.' } : { question: q.id, option };
        const r = await call('POST', `/api/c/${companyId}/answers`, body);
        note('question-answered', { id: q.id, from: q.from, text: String(q.text).slice(0, 300), options: q.options, answered: body, status: r.status });
        if (r.status === 200) interventions.questionsAnswered += 1;
      }
      // Permission asks: only "other" is allowed; anything that reaches outside the project is denied.
      for (const a of company.approvals ?? []) {
        if (a.answer || a.withdrawn) continue;
        // Never a program killer: a desk once ran `taskkill /IM node.exe`, which stops every Node program on the machine.
        const killer = /stop a program/i.test(String(a.summary)) || MACHINE_KILL.test(`${a.summary} ${a.detail}`);
        const allow = a.kind === 'other' && !killer;
        // As a person would: "Always allow" for a routine tool, so the same tool asks once. Only where the approval offers
        // it (alwaysRule): the hub refuses it elsewhere, and a refused answer left the ask waiting until it timed out as a no.
        const body = { approval: a.id, decision: allow ? 'allow' : 'deny', always: allow && Boolean(a.alwaysRule), ...(allow ? {} : { note: 'Not needed for this benchmark; carry on without it.' }) };
        const r = await call('POST', `/api/c/${companyId}/approvals`, body);
        // askKind, not kind: the event's own kind says what the harness did. A refusal keeps the hub's words.
        note(allow ? 'approval-allowed' : 'approval-denied', { id: a.id, person: a.person, askKind: a.kind, summary: a.summary, status: r.status, ...(r.status === 200 ? {} : { text: r.text.slice(0, 200) }) });
        if (r.status === 200) interventions[allow ? 'approvalsAllowed' : 'approvalsDenied'] += 1;
      }

      // Stalled? Done?
      const tasks = company.tasks ?? [];
      const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped').length;
      const idle = (company.desks?.working ?? 0) === 0 && (company.desks?.waiting ?? 0) === 0;
      if (idle && open > 0) stalledSince ??= now();
      else stalledSince = null;
      if (typeof company.done === 'number') {
        result.doneAtMs ??= Math.max(0, company.done - startedAt);
        if (idle && (company.inbox ?? 0) === 0 && !company.pause) {
          quietSince ??= now();
          if (now() - quietSince >= QUIET_MS) {
            result.done = true;
            result.doneReason = `the company marked its plan finished (${tasks.length} tasks closed, every milestone done), then nobody was at work for ${Math.round(QUIET_MS / 1000)} s`;
            break;
          }
        } else quietSince = null;
      } else quietSince = null;
    }
    await sleep(POLL_MS);
  }
  if (!result.done) {
    result.capped = true;
    result.doneReason = `cap of ${MINUTES} min reached`;
    if (stalledSince !== null) {
      const since = new Date(stalledSince).toISOString();
      result.stalledSince = since;
      result.stalled = `stalled since ${since}: nobody at work or waiting for a desk for ${Math.round((now() - stalledSince) / 60_000)} min with tasks open`;
      result.doneReason += `, ${result.stalled}`;
      // What the company itself said about it, when it had called the work stalled by then.
      if (company?.stalled?.text) result.stalledSays = company.stalled.text;
    }
  }
  result.planApprovedAtMs = planApprovedAt;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  result.doneReason = `failed: ${failure}`;
  note('failed', { message: failure });
}
result.wallMs = now() - startedAt;

// --- collect, then stop everything we started ---------------------------------------------------------------------------
await look();
if (snapshot) {
  const c = snapshot.company;
  writeJson(join(out, 'state.json'), snapshot);
  const byPerson = c.spend?.byPerson ?? [];
  const sumAll = byPerson.reduce((a, p) => a + (p.all ?? 0), 0);
  const people = Object.fromEntries((c.people ?? []).map((p) => [p.id, { title: p.title, model: p.model, cost: p.cost }]));
  writeJson(join(out, 'ledger.json'), { totals: snapshot.totals, spendByPerson: byPerson, spendTotal: sumAll, people, pricesAsOf: snapshot.pricesAsOf });
  writeJson(join(out, 'decisions.json'), c.steering?.decisions ?? []);
  writeJson(join(out, 'log.json'), c.log ?? []);
  writeJson(join(out, 'tasks.json'), c.tasks ?? []);
  result.costUsd = snapshot.totals?.cost ?? sumAll;
  result.costKind = snapshot.totals?.costExact ? 'office-ledger-exact' : 'office-ledger-estimate';
  result.tokens = snapshot.totals?.usage ?? null;
  result.tasks = { total: c.tasks?.length ?? 0, done: (c.tasks ?? []).filter((t) => t.status === 'done').length, dropped: (c.tasks ?? []).filter((t) => t.status === 'dropped').length };
  result.milestones = (c.goal?.milestones ?? []).map((m) => ({ title: m.title, done: m.doneAt !== null }));
  result.people = Object.values(people).map((p) => `${p.title} (${p.model})`);
  // v0.4 (B1): what each seat ran at, so the report says it beside arm A's effort and setup.
  result.shape = c.shape ?? 'classic';
  result.seats = await seatsOf(c);
  // v0.6: what each person cost on their own line (the strict Reviewer's above all), and the fix rounds the final review started.
  result.costByPerson = Object.fromEntries(byPerson.map((p) => [p.person ?? p.id, Number((p.all ?? 0).toFixed(4))]));
  result.seatModels = SEAT_MODELS;
  const fixes = (c.tasks ?? []).filter((t) => t.followUp?.kind === 'fix');
  result.fixRounds = {
    ran: new Set(fixes.map((t) => t.followUp.round ?? 1)).size,
    tasks: fixes.map((t) => ({ id: t.id, round: t.followUp.round ?? 1, status: t.status, items: (t.followUp.items ?? []).map((i) => String(i).slice(0, 300)) })),
    rechecks: (c.tasks ?? []).filter((t) => t.followUp?.kind === 'recheck').map((t) => ({ id: t.id, status: t.status })),
  };
  result.setup = 'lean (project and local settings, the user CLAUDE.md left out, only assigned tools and MCP servers)';
  result.questionsAsked = (c.questions ?? []).filter((q) => q.preset !== true).length;
  const preset = (c.questions ?? []).find((q) => q.preset === true);
  result.presetQuestion = preset ? { answered: preset.answer !== null, withdrawn: preset.withdrawn !== null } : null;
  result.preset = c.settings?.preset ?? null;
  result.pause = c.pause ?? null;
  result.branch = c.branch;
}

/** Each person's title, model and effort: their own effort, else their seat's under the preset (v0.4), else the desk default. */
async function seatsOf(c) {
  let seatEffort = null;
  let seatOf = null;
  let soloReviewer = null;
  let fallback = 'medium';
  try {
    ({ seatEffort } = await import(pathToFileURL(join(PRODUCT, 'src', 'core', 'presets.ts')).href));
    ({ seatOf, SOLO_REVIEWER: soloReviewer } = await import(pathToFileURL(join(PRODUCT, 'src', 'core', 'harness-shape.ts')).href));
    ({ DEFAULT_EFFORT: fallback } = await import(pathToFileURL(join(PRODUCT, 'src', 'runtime', 'harness.ts')).href));
  } catch {
    // a product from before v0.4: its desks ran at DEFAULT_EFFORT, medium
  }
  return (c.people ?? []).map((p) => {
    const own = c.steering?.people?.[p.id]?.effort ?? null;
    const seat = (c.shape === 'harness' || c.shape === 'solo') && seatOf ? seatOf(p) : null;
    const effort = own ?? (seat === 'reviewer' && c.shape === 'solo' && soloReviewer ? soloReviewer.effort : seat && seatEffort ? seatEffort(c.settings?.preset ?? 'balanced', seat) : fallback);
    return { id: p.id, title: p.title, model: p.model, effort };
  });
}

// Gracefully first (it closes the desks' trees itself), then the tree of the hub process we started, by its recorded PID.
sh(process.execPath, [join(PRODUCT, 'src', 'cli.ts'), 'hub', '--stop'], { cwd: PRODUCT, env, timeoutMs: 90_000 });
for (let i = 0; i < 40 && !hubExited; i += 1) await sleep(500);
if (!hubExited) {
  note('hub-killed', { pid: hubPid });
  killTree(hubPid);
  await sleep(1_000);
}

const git = (...args) => sh('git', args, { cwd: folder, timeoutMs: 30_000 }).stdout.trim();
result.git = { head: git('rev-parse', '--abbrev-ref', 'HEAD'), branches: git('branch', '--format=%(refname:short)').split('\n').filter(Boolean), commits: Number(git('rev-list', '--count', 'HEAD')) || 0 };
const stray = [...leftovers(folder), ...leftovers(home)];
copyTree(folder, join(out, 'project'));
result.leftoverProcesses = stray;
result.tempFolderRemoved = removeTree(folder);
removeTree(home);
result.interventionsTotal = interventions.approvalsAllowed + interventions.approvalsDenied + interventions.questionsAnswered;
result.interventions = { ...interventions, total: result.interventionsTotal };
// v0.3: the step-ins after the plan's approval, which the report counts as shots with a follow-up when the tests fail.
result.shots = { stepIns: stepInsOf(out) };
result.env = environment();
result.failure = failure;
writeJson(join(out, 'result.json'), result);
console.log(`${result.done ? 'done' : result.capped ? 'CAPPED' : 'FAILED'} after ${(result.wallMs / 1000).toFixed(1)} s: ${result.doneReason}; cost ${result.costUsd === undefined ? 'unknown' : `$${result.costUsd.toFixed(4)}`}; interventions after the plan approval: ${result.interventionsTotal}; saved to ${out}`);
if (stray.length > 0) console.warn(`WARNING: programs still running that mention the run's folders (not stopped): ${stray.map((p) => `${p.name} ${p.pid}`).join(', ')}`);
process.exit(failure ? 1 : 0);
