// The benchmark's report across arms, tasks and repeats: quality first (the blind review, then the hidden tests), then
// time and cost, then how often the person stepped in, then what to keep in mind. Writes report.md, summary.json and
// charts (charts/*.svg, each in a light and a dark version, for a <picture> element on GitHub).
//
//   node scripts/bench/report-n.mjs <out>      (the folder run-all.mjs filled: runs/, reviews/)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { die, readJson, shotsOf } from './lib.mjs';
import { CRITERIA } from './review-schema.mjs';

const out = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(out, 'runs'))) die('Usage: report-n.mjs <out>  (the folder run-all.mjs filled)');

// B0 and B1: two versions of the company side by side (a baseline and a candidate, each a frozen product copy run with
// BENCH_PRODUCT), in runs/<task>/B0-<n> and B1-<n>; the folder's name gives the arm, and summary.json the commits.
const ARM_ORDER = ['A', 'U', 'P', 'B', 'B0', 'B1'];
const NAME = { A: 'One session', U: "One session, the user's own setup (reference)", P: 'One session, planned, with subagents', B: 'Worklings company', B0: 'Company, baseline', B1: 'Company, candidate' };
const SHORT = { A: 'One session', U: 'User setup', P: 'Planned + subagents', B: 'Company', B0: 'Baseline', B1: 'Candidate' };
const ls = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

// --- read everything --------------------------------------------------------------------------------------------------
const runs = [];
for (const task of ls(join(out, 'runs'))) {
  for (const name of ls(join(out, 'runs', task))) {
    // Only run-all's own folders count: a run set aside (renamed, say B-1-void-<why>) stays on disk for the record.
    if (!/^(?:A|U|P|B|B0|B1)-\d+$/.test(name)) continue;
    const dir = join(out, 'runs', task, name);
    if (!existsSync(join(dir, 'result.json'))) continue;
    const result = readJson(join(dir, 'result.json'));
    const score = existsSync(join(dir, 'score.json')) ? readJson(join(dir, 'score.json')) : null;
    const arm = name.split('-')[0];
    runs.push({ task, arm, n: Number(name.split('-').at(-1)), result, score, shots: shotsOf(dir, { ...result, arm }, score) });
  }
}
const reviews = [];
for (const task of ls(join(out, 'reviews'))) {
  for (const name of ls(join(out, 'reviews', task))) {
    const file = join(out, 'reviews', task, name, 'review.json');
    if (existsSync(file)) reviews.push({ task, n: Number(name.replace(/^r/, '')), review: readJson(file) });
  }
}
const tasks = [...new Set(runs.map((r) => r.task))].sort();
const arms = ARM_ORDER.filter((a) => runs.some((r) => r.arm === a));
const dry = runs.some((r) => r.result.dryRun);

// --- the shared PC ----------------------------------------------------------------------------------------------------
// Every run shares the PC with whatever else runs meanwhile: the other benchmark jobs (two at a time, never two
// companies), their scoring and reviews, and any other work listed in machine-load.json ([{what, from, to}], ISO times).
// Wall time, builds and tests can stretch under that load, so each run's overlap is worked out from log.txt and that
// file and reported beside the times. Work nobody listed there is not counted.
const jobs = [];
if (existsSync(join(out, 'log.txt'))) {
  const open = new Map();
  for (const line of readFileSync(join(out, 'log.txt'), 'utf8').split('\n')) {
    const m = /^(\S+) (start|done|FAILED) (\S+)/.exec(line);
    if (!m) continue;
    const at = Date.parse(m[1]);
    if (m[2] === 'start') open.set(m[3], at);
    else if (open.has(m[3])) {
      jobs.push({ id: m[3], from: open.get(m[3]), to: at });
      open.delete(m[3]);
    }
  }
  for (const [id, from] of open) jobs.push({ id, from, to: Date.now() });
}
const otherLoad = existsSync(join(out, 'machine-load.json')) ? readJson(join(out, 'machine-load.json')).map((x) => ({ what: x.what, from: Date.parse(x.from), to: Date.parse(x.to) })) : [];
const clipTo = (span, x) => ({ from: Math.max(span.from, x.from), to: Math.min(span.to, x.to) });
for (const r of runs) {
  const span = { from: Date.parse(r.result.startedAt), to: Date.parse(r.result.startedAt) + r.result.wallMs };
  const id = `${r.task}/${r.arm}-${r.n}`;
  const others = [...jobs.filter((j) => j.id !== id).map((j) => ({ what: j.id, ...clipTo(span, j) })), ...otherLoad.map((x) => ({ what: x.what, ...clipTo(span, x) }))].filter((x) => x.to > x.from);
  // The share of the run's time when something else ran (the union of the overlaps): any of it, and apart from the
  // benchmark's own jobs, which run two at a time by design, the other work listed in machine-load.json.
  const union = (xs) => {
    let busy = 0;
    let reach = span.from;
    for (const x of [...xs].sort((p, q) => p.from - q.from)) {
      const from = Math.max(x.from, reach);
      if (x.to > from) busy += x.to - from;
      reach = Math.max(reach, x.to);
    }
    return busy;
  };
  const busy = union(others);
  const otherBusy = union(otherLoad.map((x) => ({ what: x.what, ...clipTo(span, x) })).filter((x) => x.to > x.from));
  const minutes = new Map();
  for (const x of others) minutes.set(x.what, (minutes.get(x.what) ?? 0) + (x.to - x.from) / 60_000);
  r.shared = Number.isFinite(span.from) && r.result.wallMs > 0 ? { share: busy / r.result.wallMs, otherWork: otherBusy / r.result.wallMs, with: [...minutes].map(([what, min]) => ({ what, minutes: Number(min.toFixed(1)) })) } : null;
}

// --- numbers ----------------------------------------------------------------------------------------------------------
const nums = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
const mean = (xs) => (nums(xs).length ? nums(xs).reduce((a, b) => a + b, 0) / nums(xs).length : null);
const sum = (xs) => nums(xs).reduce((a, b) => a + b, 0);
const median = (xs) => {
  const s = [...nums(xs)].sort((a, b) => a - b);
  if (s.length === 0) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const min = (xs) => (nums(xs).length ? Math.min(...nums(xs)) : null);
const max = (xs) => (nums(xs).length ? Math.max(...nums(xs)) : null);
const sd = (xs) => {
  const m = mean(xs);
  const v = nums(xs);
  return v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) : null;
};

function cell(task, arm) {
  const mine = runs.filter((r) => r.task === task && r.arm === arm);
  const revs = reviews.filter((r) => r.task === task && r.review.arms?.includes(arm) && r.review.validRounds > 0);
  const overall = revs.map((r) => r.review.mean[arm]?.overall);
  const suite = (name) => {
    const s = mine.map((r) => r.score?.hidden?.[name]).filter(Boolean);
    return s.length ? { passed: sum(s.map((x) => x.passed)), total: sum(s.map((x) => x.total)), rates: s.map((x) => (x.total ? x.passed / x.total : null)) } : null;
  };
  return {
    task, arm, runs: mine.length, done: mine.filter((r) => r.result.done).length, capped: mine.filter((r) => r.result.capped).length,
    overall, criteria: Object.fromEntries(CRITERIA.map((c) => [c.key, mean(revs.map((r) => r.review.mean[arm]?.[c.key]))])),
    ship: sum(revs.map((r) => r.review.ship?.[arm] ?? 0)), rounds: sum(revs.map((r) => r.review.validRounds)),
    core: suite('core'), edge: suite('edge'), ui: suite('ui'),
    shared: mine.map((r) => r.shared?.share ?? null),
    wallMin: mine.map((r) => r.result.wallMs / 60_000), cost: mine.map((r) => r.result.costUsd), costKinds: [...new Set(mine.map((r) => r.result.costKind))],
    steppedIn: mine.map((r) => r.result.interventions?.total ?? 0), shots: mine.map((r) => r.shots.total), stepIns: mine.map((r) => r.shots.stepIns.total), planApprovals: mine.map((r) => r.result.interventions?.planApprovals ?? 0),
    scoping: mine.map((r) => r.result.scoping?.questions ?? 0), people: mine.map((r) => r.result.proposal?.people ?? null),
    delegated: mine.map((r) => (r.result.delegated ? sum(Object.values(r.result.delegated)) : null)),
  };
}
const cells = Object.fromEntries(tasks.map((t) => [t, Object.fromEntries(arms.map((a) => [a, cell(t, a)]))]));
const byArm = Object.fromEntries(arms.map((a) => {
  const cs = tasks.map((t) => cells[t][a]);
  const all = (k) => cs.flatMap((c) => c[k]);
  const suiteAll = (k) => {
    const s = cs.map((c) => c[k]).filter(Boolean);
    return s.length ? { passed: sum(s.map((x) => x.passed)), total: sum(s.map((x) => x.total)) } : null;
  };
  return [a, { overall: all('overall'), ship: sum(cs.map((c) => c.ship)), rounds: sum(cs.map((c) => c.rounds)), core: suiteAll('core'), edge: suiteAll('edge'), ui: suiteAll('ui'), wallMin: all('wallMin'), cost: all('cost'), steppedIn: all('steppedIn'), shots: all('shots'), stepIns: all('stepIns'), runs: sum(cs.map((c) => c.runs)), done: sum(cs.map((c) => c.done)) }];
}));

// Head to head: in each reviewed repeat, which arm the reviewer scored higher overall.
const pairs = [];
for (let i = 0; i < arms.length; i += 1) for (let j = i + 1; j < arms.length; j += 1) pairs.push([arms[i], arms[j]]);
const h2h = pairs.map(([x, y]) => {
  let wx = 0;
  let wy = 0;
  let tie = 0;
  for (const r of reviews.filter((r) => r.review.validRounds > 0 && r.review.arms.includes(x) && r.review.arms.includes(y))) {
    const sx = r.review.mean[x].overall;
    const sy = r.review.mean[y].overall;
    if (Math.abs(sx - sy) < 0.25) tie += 1;
    else if (sx > sy) wx += 1;
    else wy += 1;
  }
  return { x, y, wx, wy, tie };
});

// --- formatting -------------------------------------------------------------------------------------------------------
const f1 = (v) => (typeof v === 'number' ? v.toFixed(1) : 'n/a');
const usd = (v) => (typeof v === 'number' ? `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}` : 'n/a');
const pct = (s) => (s && s.total ? `${Math.round((100 * s.passed) / s.total)}% (${s.passed}/${s.total})` : 'n/a');
const range = (xs, fmt) => (nums(xs).length > 1 ? `${fmt(min(xs))}–${fmt(max(xs))}` : nums(xs).length === 1 ? fmt(xs[0]) : 'n/a');
const m1 = (v) => `${v.toFixed(v < 10 ? 1 : 0)}`;

const L = [];
L.push(`# Benchmark results${dry ? ' (DRY RUN: Claude Code was faked, the numbers mean nothing)' : ''}`, '');
const models = [...new Set(runs.map((r) => r.result.model))].join(', ');
const reviewModels = [...new Set(reviews.map((r) => r.review.model))].join(', ');
const repeatsSeen = max(runs.map((r) => r.n)) ?? 0;
L.push(`${tasks.length} task(s) × ${arms.length} arm(s) × up to ${repeatsSeen} repeat(s): ${runs.length} run(s). Builders: ${models}. Blind reviewer: ${reviewModels || 'none yet'}, ${sum(reviews.map((r) => r.review.validRounds))} valid round(s).`, '');

L.push('## Summary', '', `| | ${arms.map((a) => NAME[a]).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
const row = (label, fn) => L.push(`| ${label} | ${arms.map((a) => fn(byArm[a], a)).join(' | ')} |`);
row('Blind review, mean overall (1–10)', (s) => `${f1(mean(s.overall))}${sd(s.overall) !== null ? ` ± ${f1(sd(s.overall))}` : ''}`);
row('Reviewer would ship it', (s) => (s.rounds ? `${s.ship} of ${s.rounds} rounds` : 'n/a'));
row('Hidden tests, core', (s) => pct(s.core));
row('Hidden tests, edge cases', (s) => pct(s.edge));
const anyUi = arms.some((a) => byArm[a].ui);
if (anyUi) row('Hidden tests, UI flows', (s) => pct(s.ui));
row('Wall time per run, median', (s) => (median(s.wallMin) === null ? 'n/a' : `${m1(median(s.wallMin))} min`));
row('Cost per run, mean (API-equivalent)', (s) => usd(mean(s.cost)));
row('Cost, all runs', (s) => usd(sum(s.cost)));
row('Times the person stepped in, per run', (s) => f1(mean(s.steppedIn)));
row('Shots per run: step-ins after the plan\'s approval, plus one when the hidden tests failed', (s) => `${f1(mean(s.shots))} (${f1(mean(s.stepIns))} step-ins)`);
row('Runs that finished', (s) => `${s.done} of ${s.runs}`);
L.push('');
if (h2h.length) {
  L.push('Head to head, per task and repeat (overall scores within 0.25 count as a tie):', '');
  for (const p of h2h) L.push(`- ${NAME[p.x]} vs ${NAME[p.y]}: ${p.wx} won, ${p.wy} lost, ${p.tie} tied.`);
  L.push('');
}

L.push('## Quality: the blind review, per task', '', 'Mean overall score over the repeats, with the range in brackets, and how many review rounds would ship each.', '');
L.push(`| Task | ${arms.map((a) => NAME[a]).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
for (const t of tasks) L.push(`| ${t} | ${arms.map((a) => { const c = cells[t][a]; return `${f1(mean(c.overall))} (${range(c.overall, f1)}), ship ${c.ship}/${c.rounds}`; }).join(' | ')} |`);
L.push('', 'By criterion, mean over every task and repeat:', '', `| Criterion | ${arms.map((a) => NAME[a]).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
for (const c of CRITERIA) L.push(`| ${c.label} | ${arms.map((a) => f1(mean(tasks.map((t) => cells[t][a].criteria[c.key])))).join(' | ')} |`);
L.push('');

L.push('## Hidden tests, per task', '', 'Core: the acceptance tests. Edge: the edge cases and errors the goal states or implies. Passed of total, summed over the repeats.', '');
L.push(`| Task | ${arms.map((a) => `${SHORT[a]}, core`).join(' | ')} | ${arms.map((a) => `${SHORT[a]}, edge`).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|${arms.map(() => '---').join('|')}|`);
for (const t of tasks) L.push(`| ${t} | ${arms.map((a) => pct(cells[t][a].core)).join(' | ')} | ${arms.map((a) => pct(cells[t][a].edge)).join(' | ')} |`);
L.push('');
if (anyUi) {
  L.push('UI flows (a full-stack task served by its own `npm start`), at 1440 and 375 px:', '', `| Task | ${arms.map((a) => `${SHORT[a]}, UI`).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
  for (const t of tasks) if (arms.some((a) => cells[t][a].ui)) L.push(`| ${t} | ${arms.map((a) => pct(cells[t][a].ui)).join(' | ')} |`);
  L.push('');
}

L.push('## Time and cost, per task', '', 'Median wall time and mean API-equivalent cost per run, with the range over the repeats.', '');
L.push(`| Task | ${arms.map((a) => `${SHORT[a]}, time`).join(' | ')} | ${arms.map((a) => `${SHORT[a]}, cost`).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|${arms.map(() => '---').join('|')}|`);
for (const t of tasks) L.push(`| ${t} | ${arms.map((a) => { const c = cells[t][a]; return median(c.wallMin) === null ? 'n/a' : `${m1(median(c.wallMin))} min (${range(c.wallMin, m1)})`; }).join(' | ')} | ${arms.map((a) => { const c = cells[t][a]; return `${usd(mean(c.cost))} (${range(c.cost, usd)})`; }).join(' | ')} |`);
L.push('');
const sharePct = (v) => `${Math.round(100 * v)}%`;
L.push('The runs shared one PC. Jobs run two at a time, never two companies, so most runs spent most of their time next to one other benchmark job (a run, a scoring or a review). Share of each run\'s wall time next to anything else, and in brackets next to other work on the PC listed in machine-load.json, per run in repeat order:', '');
L.push(`| Task | ${arms.map((a) => SHORT[a]).join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
for (const t of tasks) L.push(`| ${t} | ${arms.map((a) => { const xs = runs.filter((r) => r.task === t && r.arm === a).sort((p, q) => p.n - q.n); return xs.length ? xs.map((r) => (r.shared ? `${sharePct(r.shared.share)} (${sharePct(r.shared.otherWork)})` : 'n/a')).join(', ') : 'n/a'; }).join(' | ')} |`);
L.push('', 'What each run overlapped with, in minutes, is in summary.json (runs[].shared).', '');

/** Model, effort and loaded setup of an arm's runs, in one line (results from before v0.4 say less). */
function setupLine(results) {
  const parts = new Set();
  for (const r of results) {
    if (Array.isArray(r.seats) && r.seats.length > 0) {
      parts.add(r.seats.map((s) => `${s.title} ${s.model ?? 'model unknown'} at ${s.effort ?? 'effort unknown'}`).join(', ') + (r.setup ? `; desks ${r.setup}` : ''));
      continue;
    }
    const loaded = r.setup?.loaded;
    const what = r.setup?.kind === 'neutral' ? 'neutral (project and local settings only, no MCP servers)' : r.setup?.kind === 'user' ? "the user's own Claude Code setup" : r.arm === 'A' ? "the user's own Claude Code setup (before v0.4)" : 'lean desks';
    const counts = loaded ? `; loaded ${loaded.tools ?? '?'} tools, ${loaded.skills ?? '?'} skills, ${loaded.mcpServers?.length ?? '?'} MCP servers, ${loaded.plugins?.length ?? '?'} plugins` : '';
    parts.add(`model ${r.model ?? 'unknown'}, effort ${r.effort ?? 'not recorded'}, setup ${what}${counts}`);
  }
  return parts.size > 0 ? [...parts].join(' | ') : 'not recorded';
}

L.push('## How each arm worked', '');
for (const a of arms) {
  const cs = tasks.map((t) => cells[t][a]);
  if (a === 'A' || a === 'U') L.push(`- **${NAME[a]}**: one prompt, no follow-up; nobody stepped in.`);
  if (a === 'P') L.push(`- **${NAME[a]}**: one plan approval per run; subagent calls per run: ${range(cs.flatMap((c) => c.delegated), (v) => String(v))} (mean ${f1(mean(cs.flatMap((c) => c.delegated)))}).`);
  if (a === 'B' || a === 'B0' || a === 'B1') L.push(`- **${NAME[a]}**: people per company ${range(cs.flatMap((c) => c.people), (v) => String(v))}; scoping questions asked per run ${range(cs.flatMap((c) => c.scoping), (v) => String(v))}; plan approvals per run ${range(cs.flatMap((c) => c.planApprovals), (v) => String(v))}; other times the harness stepped in (approvals and answers) ${range(cs.flatMap((c) => c.steppedIn), (v) => String(v))}.`);
  // v0.4 (B1): what each arm ran with, so a difference in setup or effort is never read as one in structure.
  L.push(`  - Ran with: ${setupLine(runs.filter((r) => r.arm === a).map((r) => r.result))}`);
}
L.push('');

L.push('## What to keep in mind', '');
const kinds = Object.fromEntries(arms.map((a) => [a, [...new Set(tasks.flatMap((t) => cells[t][a].costKinds))].join(', ')]));
L.push(`- Costs: ${arms.map((a) => `${NAME[a]}: ${kinds[a]}`).join('; ')}. "reported" is Claude Code's own figure; "office-ledger-estimate" is the office's estimate from token counts and the published prices.`);
const leaks = reviews.filter((r) => Object.keys(r.review.blindnessLeaks ?? {}).length > 0);
if (leaks.length) L.push(`- Blindness: in ${leaks.length} review(s) a file could hint at how it was made (${leaks.map((r) => `${r.task} r${r.n}`).join(', ')}); see each review.json.`);
const positions = {};
for (const r of reviews) for (const [pos, k] of Object.entries(r.review.shipByPosition ?? {})) positions[pos] = (positions[pos] ?? 0) + k;
if (Object.keys(positions).length) L.push(`- Position check: the shipped solution was shown as ${Object.entries(positions).map(([p, k]) => `${p} ${k}×`).join(', ')}. The order rotates so each arm is shown in each position once per repeat.`);
const notDone = runs.filter((r) => !r.result.done);
if (notDone.length) L.push(`- Runs that did not finish: ${notDone.map((r) => `${r.task} ${r.arm}-${r.n} (${r.result.doneReason ?? r.result.failure ?? (r.result.capped ? 'capped' : 'not done')})`).join('; ')}.`);
L.push('');

writeFileSync(join(out, 'report.md'), `${L.join('\n')}\n`);
const perRun = runs.map((r) => ({ task: r.task, arm: r.arm, n: r.n, product: r.result.product?.commit ?? null, startedAt: r.result.startedAt, wallMin: Number((r.result.wallMs / 60_000).toFixed(2)), costUsd: r.result.costUsd, shots: r.shots, shared: r.shared }));
writeFileSync(join(out, 'summary.json'), `${JSON.stringify({ dry, tasks, arms, byArm, cells, h2h, runs: perRun, otherLoad: otherLoad.map((x) => ({ what: x.what, from: new Date(x.from).toISOString(), to: new Date(x.to).toISOString() })) }, null, 2)}\n`);

// --- charts -----------------------------------------------------------------------------------------------------------
// Static SVGs for the docs: three arms in the validated categorical order (blue, orange, aqua), a light and a dark
// version each, thin marks, a legend plus direct labels, text in text colours, one axis per chart.
const THEMES = {
  light: { surface: '#fcfcfb', text: '#0b0b0b', muted: '#52514e', grid: '#e4e3df', series: ['#2a78d6', '#eb6834', '#1baf7a', '#8a6bd1', '#1baf7a', '#a07a12'] },
  dark: { surface: '#1a1a19', text: '#f0efec', muted: '#c3c2b7', grid: '#3a3a37', series: ['#3987e5', '#d95926', '#199e70', '#9a7fe0', '#199e70', '#c49a2c'] },
};
const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const colorOf = (th, arm) => th.series[ARM_ORDER.indexOf(arm)];

function legend(th, x, y) {
  let at = x;
  return arms.map((a) => {
    const g = `<circle cx="${at + 5}" cy="${y - 4}" r="5" fill="${colorOf(th, a)}"/><text x="${at + 15}" y="${y}" font-size="13" fill="${th.text}">${esc(SHORT[a])}</text>`;
    at += 30 + SHORT[a].length * 7.2;
    return g;
  }).join('');
}

/** Rows of tasks, an x scale, and per arm a dot at the value with a thin line over its range. */
function dotRows(th, { title, note, value, lo, hi, scale, ticks, tickLabel }) {
  const W = 760, left = 120, right = 24, top = 70, rowH = 16 * arms.length + 22, H = top + rowH * tasks.length + 46;
  const x = (v) => left + scale(v) * (W - left - right);
  const parts = [`<rect width="${W}" height="${H}" rx="10" fill="${th.surface}"/>`, `<text x="20" y="28" font-size="16" font-weight="600" fill="${th.text}">${esc(title)}</text>`, legend(th, 20, 52)];
  for (const t of ticks) parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 40}" stroke="${th.grid}" stroke-width="1"/><text x="${x(t)}" y="${H - 24}" font-size="12" text-anchor="middle" fill="${th.muted}">${esc(tickLabel(t))}</text>`);
  tasks.forEach((t, i) => {
    const y0 = top + i * rowH;
    parts.push(`<text x="20" y="${y0 + rowH / 2 + 4}" font-size="13" fill="${th.text}">${esc(t)}</text>`);
    arms.forEach((a, k) => {
      const c = cells[t][a];
      const v = value(c);
      if (v === null) return;
      const y = y0 + 12 + k * 16;
      const l = lo(c);
      const h = hi(c);
      if (l !== null && h !== null && h > l) parts.push(`<line x1="${x(l)}" x2="${x(h)}" y1="${y}" y2="${y}" stroke="${colorOf(th, a)}" stroke-width="2" stroke-linecap="round"/>`);
      parts.push(`<circle cx="${x(v)}" cy="${y}" r="5" fill="${colorOf(th, a)}" stroke="${th.surface}" stroke-width="2"><title>${esc(`${t}, ${SHORT[a]}: ${tickLabel(v)}`)}</title></circle>`);
    });
  });
  if (note) parts.push(`<text x="20" y="${H - 6}" font-size="11" fill="${th.muted}">${esc(note)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="${esc(title)}">${parts.join('')}</svg>\n`;
}

const logScale = (lo, hi) => (v) => (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
const allCost = nums(runs.map((r) => r.result.costUsd));
const allWall = nums(runs.map((r) => r.result.wallMs / 60_000));
const costLo = Math.max(0.001, 10 ** Math.floor(Math.log10(Math.max(1e-3, min(allCost) ?? 0.1))));
const costHi = 10 ** Math.ceil(Math.log10(Math.max(costLo * 10, max(allCost) ?? 1)));
const wallLo = Math.max(0.01, 10 ** Math.floor(Math.log10(Math.max(0.01, min(allWall) ?? 1))));
const wallHi = 10 ** Math.ceil(Math.log10(Math.max(wallLo * 10, max(allWall) ?? 10)));
const decades = (lo, hi) => {
  const t = [];
  for (let v = lo; v <= hi * 1.0001; v *= 10) for (const m of [1, 2, 5]) if (v * m <= hi * 1.0001) t.push(v * m);
  return t;
};
const CHARTS = {
  quality: (th) => dotRows(th, { title: 'Blind review, overall score (1–10): mean and range over the repeats', note: 'Higher is better. Each dot is the mean over a task\'s repeats; the line spans the lowest and highest.', value: (c) => mean(c.overall), lo: (c) => min(c.overall), hi: (c) => max(c.overall), scale: (v) => (v - 1) / 9, ticks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], tickLabel: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) }),
  cost: (th) => dotRows(th, { title: 'Cost per run, API-equivalent (log scale): mean and range', note: 'Lower is cheaper. Company costs are the office\'s estimate from token counts.', value: (c) => mean(c.cost), lo: (c) => min(c.cost), hi: (c) => max(c.cost), scale: logScale(costLo, costHi), ticks: decades(costLo, costHi), tickLabel: (v) => `$${v >= 1 ? v.toFixed(0) : v.toFixed(v >= 0.1 ? 1 : 2)}` }),
  time: (th) => dotRows(th, { title: 'Wall time per run, minutes (log scale): median and range', note: 'Lower is faster. From the first prompt to the finished work, with nobody waiting on a person.', value: (c) => median(c.wallMin), lo: (c) => min(c.wallMin), hi: (c) => max(c.wallMin), scale: logScale(wallLo, wallHi), ticks: decades(wallLo, wallHi), tickLabel: (v) => (v >= 1 ? v.toFixed(0) : v.toFixed(1)) }),
};
mkdirSync(join(out, 'charts'), { recursive: true });
for (const [name, draw] of Object.entries(CHARTS)) for (const [mode, th] of Object.entries(THEMES)) writeFileSync(join(out, 'charts', `${name}-${mode}.svg`), draw(th));

console.log(`report: ${join(out, 'report.md')} (${runs.length} runs, ${reviews.length} reviews${dry ? ', DRY' : ''}); charts in ${join(out, 'charts')}`);
