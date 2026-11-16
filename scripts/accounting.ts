// Where a company run's tokens went: by person, by what began each turn, by what the turn did, cached against uncached.
//
//   node scripts/accounting.ts <company folder>... [--projects <claude projects dir>] [--json]
//
// A company folder holds .worklings/ (events.jsonl, company.json, proposals/); a run folder with the company in its
// project/ folder works too. Reads only: it makes no model calls and writes nothing. The company's records are read the
// way the office opens them (company.json, then the later log lines) but their signatures are not checked, so only point
// it at runs you trust. Transcripts come from ~/.claude/projects (or --projects); a session is found by its id in any
// project folder there, so task worktrees under other working folders are found too.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  addSubagent,
  analyseSession,
  cachedShare,
  type Desk,
  freshSessionSavings,
  group,
  type MessageFacts,
  type ParsedSession,
  parseSession,
  type PersonInfo,
  repriced,
  roleOf,
  type Role,
  total,
  TRIGGERS,
  type TurnStat,
  WORKS,
  type Bucket,
} from '../src/core/accounting.ts';
import { type CompanyEvent, type CompanyState, fold, foundedState, isCompanyEvent, type ProposalRef, reviveState } from '../src/core/company-state.ts';
import type { OrgProposal } from '../src/core/org.ts';
import { costOf } from '../src/core/pricing.ts';
import { ZERO_USAGE } from '../src/core/usage.ts';
import { plainPath } from '../src/safe-fs.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// Reading a company's records

const EVENT = /^\{"seq":(\d+),"event":([\s\S]*),"mac":"[0-9a-f]{64}"\}$/;
const STATE = /^\{"seq":(\d+),"state":([\s\S]*),"mac":"[0-9a-f]{64}"\}$/;
const PROPOSAL = /^\{"n":(\d+),"proposal":([\s\S]*),"mac":"[0-9a-f]{64}"\}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readText(root: string, rel: string): string | null {
  const path = plainPath(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** The folder whose .worklings/ holds the company: the one given, or its project/ folder (a benchmark run's layout). */
export function companyFolder(given: string): string | null {
  const here = resolve(given);
  for (const candidate of [here, join(here, 'project')]) if (existsSync(join(candidate, '.worklings', 'events.jsonl'))) return candidate;
  return null;
}

export interface LoadedCompany {
  state: CompanyState;
  warnings: string[];
}

/** Opens the company as the store does, without its signatures: company.json when it reads, then the later log lines. */
export function loadCompany(root: string): LoadedCompany {
  const warnings: string[] = [];
  const log = readText(root, '.worklings/events.jsonl');
  if (log === null) throw new Error(`There is no company in ${root}.`);
  const lines = log.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
  const first = lines[0] ? EVENT.exec(lines[0]) : null;
  const founded = first?.[2] ? parseJson(first[2]) : undefined;
  if (!isCompanyEvent(founded) || founded.type !== 'founded') throw new Error(`The first line of ${root}\\.worklings\\events.jsonl doesn't found a company.`);
  let state = foundedState(founded);
  let from = 1;
  const snapshotText = readText(root, '.worklings/company.json');
  const snap = snapshotText ? STATE.exec(snapshotText.trim()) : null;
  const revived = snap?.[2] ? reviveState(parseJson(snap[2])) : null;
  if (revived && revived.id === founded.id) {
    state = revived;
    from = Number(snap?.[1] ?? 0);
  } else if (snapshotText) warnings.push('company.json did not read; the company was rebuilt from its log.');
  const readProposal = (ref: ProposalRef): OrgProposal | null => {
    const text = readText(root, `.worklings/proposals/${ref.n}.json`);
    const m = text ? PROPOSAL.exec(text.trim()) : null;
    const body = m?.[2] ? parseJson(m[2]) : undefined;
    return isObj(body) ? (body as unknown as OrgProposal) : null;
  };
  const resolveEvent = (event: CompanyEvent): CompanyEvent | null => {
    if (event.type === 'batch') {
      const inner: CompanyEvent[] = [];
      for (const e of Array.isArray(event.events) ? event.events : []) {
        const r = isCompanyEvent(e) ? resolveEvent(e) : null;
        if (!r) return null;
        inner.push(r);
      }
      return { type: 'batch', events: inner };
    }
    if (event.type !== 'proposal' && event.type !== 'proposal-edited') return event;
    if (event.ref === undefined) return isObj(event.proposal) ? event : null;
    const proposal = readProposal(event.ref);
    return proposal ? { ...event, proposal } : null;
  };
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const m = EVENT.exec(line);
    const n = m ? Number(m[1]) : 0;
    if (!m || n <= from) continue;
    const event = parseJson(m[2] ?? '');
    if (!isCompanyEvent(event) || event.type === 'founded') {
      skipped += 1;
      continue;
    }
    try {
      const resolved = resolveEvent(event);
      if (!resolved) skipped += 1;
      else state = fold(state, resolved);
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) warnings.push(`${skipped} log lines could not be folded and were left out.`);
  return { state, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Finding transcripts

const claudeProjects = (given: string | null): string => given ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');

/** Every session transcript under the projects folder, by session id: the id names the file in whichever folder it ran. */
function indexTranscripts(projects: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(projects)) return out;
  for (const dir of readdirSync(projects)) {
    const full = join(projects, dir);
    try {
      if (!statSync(full).isDirectory()) continue;
      for (const name of readdirSync(full)) if (name.endsWith('.jsonl')) out.set(name.slice(0, -6), join(full, name));
    } catch {
      // A folder that vanished while reading is simply not there.
    }
  }
  return out;
}

function subagentTexts(transcript: string): string[] {
  const dir = join(transcript.slice(0, -6), 'subagents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => readFileSync(join(dir, n), 'utf8'));
}

// ---------------------------------------------------------------------------------------------------------------
// One run

export interface DeskReport {
  person: string;
  role: Role;
  session: string;
  mappedBy: 'records' | 'transcript';
  turns: number;
  model: string;
  desk: Desk;
  /** The context after each turn, for how it grows. */
  growth: number[];
}

export interface RunReport {
  folder: string;
  /** A short unique name: the last folders of the path, without "project". */
  label: string;
  name: string;
  prompt: string;
  people: PersonInfo[];
  warnings: string[];
  unreadable: string[];
  desks: DeskReport[];
  turns: TurnStat[];
  /** What the company's own records say each person cost, to check the transcripts against. */
  recordedCost: Record<string, number>;
  /** v0.2: the desks the office closed at a handover (the context before, and after the new page's first turn). */
  handovers: HandoverRow[];
}

export interface HandoverRow {
  person: string;
  at: number;
  /** Who wrote the notes: the person, or the office from its records. */
  by: 'person' | 'office';
  before: number | null;
  after: number | null;
}

function peopleOf(state: CompanyState): PersonInfo[] {
  const proposed = state.proposal?.people ?? [];
  const ids = new Set(proposed.map((p) => p.id));
  const out: PersonInfo[] = proposed.map((p) => ({ id: p.id, title: p.title, level: p.level, reportsTo: p.reportsTo }));
  for (const id of Object.keys(state.desks)) if (!ids.has(id)) out.push({ id, title: id, level: id === 'ceo' ? 'ceo' : 'worker' });
  return out;
}

/** A desk whose records don't name its session: the house rules at the top of its transcript say whose it is. */
function personFromHead(head: string, people: readonly PersonInfo[]): PersonInfo | null {
  const lower = head.toLowerCase();
  return people.find((p) => p.title && lower.includes(p.title.toLowerCase())) ?? null;
}

/** "…\runs\api\B-1\project" to "api/B-1"; "…\corner-bakery" to "corner-bakery". */
export function labelOf(folder: string): string {
  const parts = resolve(folder).split(/[\\/]/).filter((x) => x !== '');
  if (parts.at(-1) === 'project') parts.pop();
  const runs = parts.lastIndexOf('runs');
  return (runs !== -1 && runs < parts.length - 1 ? parts.slice(runs + 1) : parts.slice(-1)).join('/');
}

export function analyseRun(given: string, projectsDir: string | null): RunReport {
  const folder = companyFolder(given);
  if (!folder) throw new Error(`No company in ${given}: there is no .worklings/events.jsonl there or in its project/ folder.`);
  const { state, warnings } = loadCompany(folder);
  const people = peopleOf(state);
  const projects = claudeProjects(projectsDir);
  const transcripts = indexTranscripts(projects);
  const messages = new Map<string, MessageFacts>();
  for (const m of state.messages) messages.set(m.id, m);
  const lookup = (id: string): MessageFacts | null => messages.get(id) ?? null;
  const byId = new Map(people.map((p) => [p.id, p]));
  const above = (who: string, of: string): boolean => {
    for (let at = byId.get(of)?.reportsTo ?? null, hops = 0; at !== null && hops < 30; at = byId.get(at)?.reportsTo ?? null, hops += 1) if (at === who) return true;
    return false;
  };
  const direction = (from: string, to: string): 'down' | 'up' | 'side' => (above(from, to) ? 'down' : above(to, from) ? 'up' : 'side');

  const unreadable: string[] = [];
  const turns: TurnStat[] = [];
  const desks: DeskReport[] = [];
  const claimed = new Set<string>();
  const recordedCost: Record<string, number> = {};
  const handovers: HandoverRow[] = [];

  const take = (person: PersonInfo, session: string, parsed: ParsedSession, mappedBy: DeskReport['mappedBy']): void => {
    const { desk, turns: t } = analyseSession({ person, session, parsed, message: lookup, direction });
    turns.push(...t);
    claimed.add(session);
    desks.push({ person: person.id, role: roleOf(person), session, mappedBy, turns: t.length, model: desk.model, desk, growth: t.map((x) => x.calls.filter((c) => !c.sub).reduce((a, c) => Math.max(a, c.ctx), 0)) });
  };
  const read = (session: string): ParsedSession | null => {
    const path = transcripts.get(session);
    if (!path) return null;
    const parsed = parseSession(readFileSync(path, 'utf8'));
    for (const text of subagentTexts(path)) addSubagent(parsed, text);
    return parsed;
  };

  for (const person of people) {
    const record = Object.hasOwn(state.desks, person.id) ? state.desks[person.id] : undefined;
    if (record) recordedCost[person.id] = record.cost + record.unpriced;
    for (const h of record?.handovers ?? []) handovers.push({ person: person.id, at: h.at, by: h.by, before: h.before, after: h.after });
    for (const session of record?.sessions ?? []) {
      if (!SESSION_ID.test(session)) {
        unreadable.push(`${person.id}: "${session.slice(0, 20)}" is not a session id`);
        continue;
      }
      const parsed = read(session);
      if (!parsed) unreadable.push(`${person.id}: transcript ${session} is not under ${projects}`);
      else take(person, session, parsed, 'records');
    }
  }

  // Fallback: transcripts of this company's folders that no record claimed, named by the house rules in them.
  const encode = (path: string): string => path.replace(/[^A-Za-z0-9]/g, '-');
  const wanted = new Set([encode(state.root), encode(folder)]);
  for (const [session, path] of transcripts) {
    if (claimed.has(session)) continue;
    const dir = path.slice(0, path.lastIndexOf(path.includes('\\') ? '\\' : '/')).split(/[\\/]/).pop() ?? '';
    if (!wanted.has(dir)) continue;
    const parsed = read(session);
    const who = parsed?.shape ? personFromHead(parsed.shape.houseHead, people) : null;
    if (parsed && who) take(who, session, parsed, 'transcript');
    else if (parsed) unreadable.push(`transcript ${session} in ${dir} belongs to nobody in the records (its house rules don't name a known person)`);
  }
  if (desks.length === 0) unreadable.push(`no transcript could be mapped to a person (looked in ${projects})`);
  handovers.sort((a, b) => a.at - b.at);
  return { folder, label: labelOf(folder), name: state.name, prompt: state.prompt, people, warnings, unreadable, desks, turns, recordedCost, handovers };
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers

const roleOfTurn = (r: RunReport, t: TurnStat): Role => {
  const p = r.people.find((x) => x.id === t.person);
  return p ? roleOf(p) : 'maker';
};

/** The tokens of the first request that Claude Code's own setup (not the office's prompt) accounts for. */
const USER_SETUP = ['skill list', 'deferred tool names', 'agent list', 'mcp server instructions', 'CLAUDE.md and rules', 'session-start hook text', 'other'];

export interface Levers {
  /** Dollars each lever could have saved on the measured turns: an upper bound, or an estimate where named. */
  items: { lever: string; saved: number; note: string }[];
}

const ROUTING_TRIGGERS = new Set(['relay', 'report-up', 'question-up', 'stall-nudge', 'unreported-nudge', 'task-update', 'office-notice', 'restart', 'message-up', 'message-side']);
const ROUTING_WORK = new Set(['relaying', 'idle', 'reporting']);
const PAPERWORK_WORK = new Set(['idle', 'reporting', 'relaying', 'deciding']);
/** Small jobs: companies of this many desks or fewer (the benchmark's three-person companies). */
const SMALL = 3;
const onlyOrgTools = (t: TurnStat): boolean => Object.keys(t.tools).every((n) => n.startsWith('mcp__org__') || n === 'ToolSearch');

export function leversOf(runs: readonly RunReport[]): Levers {
  let solo = 0;
  let pair = 0;
  let smallCost = 0;
  let smallRuns = 0;
  let routing = 0;
  let mechanical = 0;
  let qa = 0;
  let fresh = 0;
  let lean = 0;
  let leanTools = 0;
  let longCtx = 0;
  const modelSaved: Record<string, number> = { 'claude-haiku-5-5': 0, 'claude-haiku-4-5': 0 };
  let routingTurns = 0;
  let mechanicalTurns = 0;
  let ctx150Calls = 0;
  let top5 = 0;
  const cold = coldTurns(runs);
  let allCost = 0;
  for (const r of runs) {
    allCost += r.turns.reduce((a, t) => a + t.cost, 0);
    const sorted = [...r.turns].sort((a, b) => b.cost - a.cost);
    top5 += sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.05))).reduce((a, t) => a + t.cost, 0);
    // Handovers give a person several desks (sessions): a small company is counted by its people.
    const small = new Set(r.desks.map((d) => d.person)).size <= SMALL;
    if (small) {
      smallRuns += 1;
      smallCost += r.turns.reduce((a, t) => a + t.cost, 0);
    }
    for (const t of r.turns) {
      const role = roleOfTurn(r, t);
      if (small && role !== 'maker') solo += t.cost;
      if (small && role === 'ceo') pair += t.cost;
      if (role === 'checker') qa += t.cost;
      if ((role === 'ceo' || role === 'manager') && ROUTING_TRIGGERS.has(t.trigger) && ROUTING_WORK.has(t.work)) {
        routing += t.cost;
        routingTurns += 1;
      }
      if ((role === 'ceo' || role === 'manager') && PAPERWORK_WORK.has(t.work) && onlyOrgTools(t)) {
        mechanical += t.cost;
        mechanicalTurns += 1;
      }
      if (role !== 'maker') for (const target of Object.keys(modelSaved)) modelSaved[target] = (modelSaved[target] ?? 0) + (t.cost - repriced(t.calls, target));
      for (const c of t.calls) {
        if (c.ctx > 150_000) {
          longCtx += c.cost;
          ctx150Calls += 1;
        }
      }
    }
    for (const d of r.desks) {
      const mine = r.turns.filter((t) => t.session === d.session);
      const fixed = d.desk.first?.prompt ?? 0;
      fresh += freshSessionSavings(mine, fixed, d.desk.first?.cacheWrite ?? fixed).saved;
      const calls = mine.flatMap((t) => t.calls).filter((c) => !c.sub);
      const removable = USER_SETUP.reduce((a, k) => a + (d.desk.overhead[k] ?? 0), 0);
      const used = new Set(mine.flatMap((t) => Object.keys(t.tools)));
      const shape = d.desk.shape;
      let unusedChars = 0;
      let toolChars = 0;
      for (const tool of shape?.tools ?? []) {
        toolChars += tool.chars;
        if (!used.has(tool.name)) unusedChars += tool.chars;
      }
      const toolTokens = (d.desk.overhead['built-in tools'] ?? 0) + (d.desk.overhead['org tools'] ?? 0) + Object.entries(d.desk.overhead).filter(([k]) => k.startsWith('mcp tools')).reduce((a, [, v]) => a + v, 0);
      const unusedTokens = toolChars > 0 ? Math.round((unusedChars / toolChars) * toolTokens) : 0;
      const price = (tokens: number): number => (calls.length === 0 ? 0 : (costOf(d.model, { ...ZERO_USAGE, cacheRead: tokens * Math.max(0, calls.length - 1), cacheWrite1h: tokens }) ?? 0));
      lean += price(removable);
      leanTools += price(unusedTokens);
    }
  }
  return {
    items: [
      { lever: `Solo mode for small jobs (${smallRuns} runs of ${SMALL} or fewer people: no CEO, no checker)`, saved: solo, note: `all CEO and checker cost in runs that cost $${smallCost.toFixed(2)} together; upper bound, and the independent check goes with it` },
      { lever: 'Pair mode for small jobs (maker and checker, no CEO)', saved: pair, note: `the CEO's cost in those ${smallRuns} runs; upper bound` },
      { lever: 'Models by role (CEO, heads, checkers on Haiku 5.5)', saved: modelSaved['claude-haiku-5-5'] ?? 0, note: 'the same tokens at Haiku 5.5 list prices; quality unmeasured' },
      { lever: 'Models by role (CEO, heads, checkers on Haiku 4.5)', saved: modelSaved['claude-haiku-4-5'] ?? 0, note: 'the same tokens at Haiku 4.5 list prices; quality unmeasured' },
      { lever: 'Routing without CEO or head turns', saved: routing, note: `${routingTurns} manager turns that only relayed, reported or did nothing, on routing triggers; upper bound` },
      { lever: 'A fresh session per task', saved: fresh, note: 'cache reads of context carried in from earlier tasks, less rewriting the fixed prompt each time; estimate' },
      { lever: 'Leaner desks: drop the user setup (skills, hooks, CLAUDE.md, agent and tool lists)', saved: lean, note: 'estimated from character shares of the first request, over every later request' },
      { lever: 'Leaner desks: tools the desk never called', saved: leanTools, note: 'same estimate; built-in and org tool definitions the desk never used' },
      { lever: 'Office work done by code', saved: mechanical, note: `${mechanicalTurns} CEO and head turns that only used org tools to decide, relay, report or wait (paperwork; overlaps routing); upper bound` },
      { lever: 'QA scaled to risk', saved: qa, note: 'all checker cost; upper bound' },
      { lever: 'Keeping caches warm (turns that began on a cold cache)', saved: cold.excess, note: `${cold.turns} turns whose first request rewrote most of the prompt; what warm reads would have saved` },
      { lever: 'Budgets: calls with a prompt over 150k tokens', saved: longCtx, note: `${ctx150Calls} calls; what a context cap or a reset at 150k would act on` },
      { lever: 'Budgets: the costliest 5% of turns', saved: top5, note: `of $${allCost.toFixed(2)}; what a per-turn budget would act on` },
    ],
  };
}

/**
 * Turns that began on a cold cache: the first request of a turn after a session's first wrote most of its prompt again
 * (the cache had lapsed between turns). What they paid over reading the same tokens from a warm cache is the excess.
 */
export function coldTurns(runs: readonly RunReport[]): { turns: number; written: number; excess: number } {
  let turns = 0;
  let written = 0;
  let excess = 0;
  for (const r of runs) {
    for (const t of r.turns) {
      const c = t.calls.find((x) => !x.sub);
      if (!c || t.n === 0 || c.ctx < 60_000 || c.usage.cacheRead >= c.ctx / 2) continue;
      const w = c.usage.cacheWrite5m + c.usage.cacheWrite1h;
      turns += 1;
      written += w;
      excess += (costOf(c.model, { ...ZERO_USAGE, cacheWrite5m: c.usage.cacheWrite5m, cacheWrite1h: c.usage.cacheWrite1h }) ?? 0) - (costOf(c.model, { ...ZERO_USAGE, cacheRead: w }) ?? 0);
    }
  }
  return { turns, written, excess };
}

/** How long a desk sat between turns, against whether its next turn began on a cold cache. */
export function gapBands(runs: readonly RunReport[]): { band: string; turns: number; cold: number; excess: number }[] {
  const bands = [
    { band: 'under 2 min', upTo: 2 * 60_000, turns: 0, cold: 0, excess: 0 },
    { band: '2 to 4 min', upTo: 4 * 60_000, turns: 0, cold: 0, excess: 0 },
    { band: '4 to 6 min', upTo: 6 * 60_000, turns: 0, cold: 0, excess: 0 },
    { band: '6 to 15 min', upTo: 15 * 60_000, turns: 0, cold: 0, excess: 0 },
    { band: 'over 15 min', upTo: Infinity, turns: 0, cold: 0, excess: 0 },
  ];
  for (const r of runs) {
    for (const t of r.turns) {
      const c = t.calls.find((x) => !x.sub);
      if (!c || t.gapMs === null || c.ctx < 60_000) continue;
      const b = bands.find((x) => (t.gapMs ?? 0) <= x.upTo);
      if (!b) continue;
      b.turns += 1;
      if (c.usage.cacheRead < c.ctx / 2) {
        b.cold += 1;
        const w = c.usage.cacheWrite5m + c.usage.cacheWrite1h;
        b.excess += (costOf(c.model, { ...ZERO_USAGE, cacheWrite5m: c.usage.cacheWrite5m, cacheWrite1h: c.usage.cacheWrite1h }) ?? 0) - (costOf(c.model, { ...ZERO_USAGE, cacheRead: w }) ?? 0);
      }
    }
  }
  return bands;
}

/**
 * What handovers did: how many, who wrote the notes, the context the old page had and the new page's after its first
 * turn, and what the turns that asked for them cost. `saved` is the carried context left behind, in tokens, per turn.
 */
export function handoverStats(runs: readonly RunReport[]): { count: number; byPerson: number; byOffice: number; before: number | null; after: number | null; carriedLeft: number | null; askTurns: number; askCost: number } {
  const rows = runs.flatMap((r) => r.handovers);
  const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const both = rows.filter((h) => h.before !== null && h.after !== null);
  const asks = runs.flatMap((r) => r.turns).filter((t) => t.trigger === 'handover');
  return {
    count: rows.length,
    byPerson: rows.filter((h) => h.by === 'person').length,
    byOffice: rows.filter((h) => h.by === 'office').length,
    before: mean(rows.flatMap((h) => (h.before === null ? [] : [h.before]))),
    after: mean(rows.flatMap((h) => (h.after === null ? [] : [h.after]))),
    carriedLeft: mean(both.map((h) => (h.before ?? 0) - (h.after ?? 0))),
    askTurns: asks.length,
    askCost: asks.reduce((a, t) => a + t.cost, 0),
  };
}

function handoverSection(runs: readonly RunReport[]): string[] {
  const s = handoverStats(runs);
  if (s.count === 0) return [];
  const rows = runs.flatMap((r) => r.handovers.map((h) => [runs.length > 1 ? `${r.label}/${h.person}` : h.person, new Date(h.at).toISOString().slice(11, 19), h.by, h.before === null ? '-' : k(h.before), h.after === null ? '-' : k(h.after)]));
  return [
    '',
    '**Handovers (desks closed to keep their context small)**',
    '',
    table(['person', 'at', 'notes by', 'context before', 'context after the first turn'], rows),
    '',
    `${s.count} handovers (${s.byPerson} with the person's own notes, ${s.byOffice} with notes the office wrote). Mean context ${s.before === null ? '-' : k(s.before)} before, ${s.after === null ? '-' : k(s.after)} after the new page's first turn${s.carriedLeft === null ? '' : `, ${k(s.carriedLeft)} left behind per turn`}. The ${s.askTurns} turns that asked for notes cost ${usd(s.askCost)}.`,
  ];
}

export const SPLIT_KEYS = ['fixed prompt, re-read', 'working context, re-read', 'cache writes after start-up', 'desk start-up (first request)', 'output', 'uncached input'] as const;
export type SplitKey = (typeof SPLIT_KEYS)[number];

/**
 * The run's dollars by what they paid for. A desk's fixed prompt is its first request's prompt: every later request
 * re-reads it from the cache, so its reads are priced apart from the reads of the working context on top of it.
 */
export function dollarSplit(r: RunReport): Record<SplitKey, number> {
  const out: Record<SplitKey, number> = { 'fixed prompt, re-read': 0, 'working context, re-read': 0, 'cache writes after start-up': 0, 'desk start-up (first request)': 0, output: 0, 'uncached input': 0 };
  for (const d of r.desks) {
    const fixed = d.desk.first?.prompt ?? 0;
    const mine = r.turns.filter((t) => t.session === d.session).flatMap((t) => t.calls).filter((c) => !c.sub);
    mine.forEach((c, i) => {
      const price = (u: Partial<typeof ZERO_USAGE>): number => costOf(c.model, { ...ZERO_USAGE, ...u }, { fast: c.fast, usOnly: c.usOnly }) ?? 0;
      const fixedRead = Math.min(fixed, c.usage.cacheRead);
      const write = price({ cacheWrite5m: c.usage.cacheWrite5m, cacheWrite1h: c.usage.cacheWrite1h });
      out['fixed prompt, re-read'] += price({ cacheRead: fixedRead });
      out['working context, re-read'] += price({ cacheRead: c.usage.cacheRead - fixedRead });
      out[i === 0 ? 'desk start-up (first request)' : 'cache writes after start-up'] += write;
      out.output += price({ output: c.usage.output });
      out['uncached input'] += price({ input: c.usage.input });
    });
  }
  return out;
}

/** Requests by the size of their prompt: how many, and what they cost. */
export function contextBands(runs: readonly RunReport[]): { band: string; calls: number; cost: number }[] {
  const bands = [
    { band: 'under 60k', upTo: 60_000, calls: 0, cost: 0 },
    { band: '60k to 100k', upTo: 100_000, calls: 0, cost: 0 },
    { band: '100k to 150k', upTo: 150_000, calls: 0, cost: 0 },
    { band: 'over 150k', upTo: Infinity, calls: 0, cost: 0 },
  ];
  for (const r of runs) {
    for (const t of r.turns) {
      for (const c of t.calls) {
        const b = bands.find((x) => c.ctx <= x.upTo);
        if (b && !c.sub) {
          b.calls += 1;
          b.cost += c.cost;
        }
      }
    }
  }
  return bands;
}

// ---------------------------------------------------------------------------------------------------------------
// Printing

const usd = (n: number): string => `$${n.toFixed(2)}`;
const k = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n)));
const pct = (n: number, of: number): string => (of === 0 ? '-' : `${((n / of) * 100).toFixed(0)}%`);

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map((h, i) => (i === 0 ? '---' : '---:'))), ...rows.map(line)].join('\n');
}

function bucketRow(label: string, b: Bucket, whole: Bucket): string[] {
  const u = b.usage;
  return [
    label,
    String(b.turns),
    k(u.input),
    k(u.cacheWrite5m + u.cacheWrite1h),
    k(u.cacheRead),
    k(u.output),
    usd(b.cost),
    pct(b.cost, whole.cost),
    b.calls === 0 ? '-' : k(b.ctxSum / b.calls),
    k(b.ctxMax),
  ];
}
const BUCKET_HEAD = ['', 'turns', 'uncached in', 'cache write', 'cache read', 'output', 'cost', 'share', 'avg ctx', 'max ctx'];

function tableOf<K extends string>(runTurns: readonly TurnStat[], label: string, key: (t: TurnStat) => K, order?: readonly K[]): string {
  const whole = total(runTurns);
  const g = group(runTurns, key);
  const keys = order ? order.filter((o) => g.has(o)) : [...g.keys()].sort((a, b) => (g.get(b)?.cost ?? 0) - (g.get(a)?.cost ?? 0));
  const rows = keys.map((x) => bucketRow(x, g.get(x) as Bucket, whole));
  rows.push(bucketRow('all', whole, whole));
  return table([label, ...BUCKET_HEAD.slice(1)], rows);
}

/** The cache reads alone, by person and by trigger and by work kind: where the reading happens. */
function cacheReadTable(turns: readonly TurnStat[], label: string, key: (t: TurnStat) => string): string {
  const g = group(turns, key);
  const all = total(turns).usage.cacheRead;
  const rows = [...g.entries()].sort((a, b) => b[1].usage.cacheRead - a[1].usage.cacheRead).map(([name, b]) => [name, String(b.turns), k(b.usage.cacheRead), pct(b.usage.cacheRead, all), k(b.turns === 0 ? 0 : b.usage.cacheRead / b.turns), usd(costOf('claude-sonnet-5-5', { ...ZERO_USAGE, cacheRead: b.usage.cacheRead }) ?? 0)]);
  return table([label, 'turns', 'cache read', 'share of reads', 'reads per turn', 'read cost at $0.10/M'], rows);
}

function growthTable(r: RunReport): string {
  const rows = r.desks.map((d) => {
    const g = d.growth;
    const at = (f: number): string => k(g[Math.min(g.length - 1, Math.floor(f * (g.length - 1)))] ?? 0);
    const mine = r.turns.filter((t) => t.session === d.session);
    return [`${d.person}${d.mappedBy === 'transcript' ? ' (by transcript)' : ''}`, String(d.turns), at(0), at(0.25), at(0.5), at(0.75), at(1), k(Math.max(0, ...g)), k(total(mine).usage.cacheRead)];
  });
  return table(['desk', 'turns', 'first turn', '25%', '50%', '75%', 'last turn', 'largest', 'cache read, whole session'], rows);
}

function overheadTable(r: RunReport): string {
  const rows = r.desks.map((d) => {
    const f = d.desk.first;
    const parts = Object.entries(d.desk.overhead).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => `${name} ${k(n)}`).join(', ');
    return [d.person, f ? k(f.prompt) : '-', f ? k(f.cacheWrite) : '-', f ? k(f.cacheRead) : '-', f ? k(f.input) : '-', f ? usd(f.cost) : '-', parts];
  });
  return table(['desk', 'first request', 'of it written', 'of it read (shared prefix)', 'uncached', 'its cost', 'what it holds (estimated from characters)'], rows);
}

export function render(r: RunReport): string {
  const whole = total(r.turns);
  const out: string[] = [];
  const recorded = Object.values(r.recordedCost).reduce((a, b) => a + b, 0);
  out.push(`### ${r.label}: ${r.name}`, `Folder: ${r.folder}`, '');
  out.push(`${r.people.length} people, ${r.desks.length} desks read, ${whole.turns} turns, ${whole.calls} requests. Transcripts price at ${usd(whole.cost)}; the company's own records say ${usd(recorded)}. Cached share of input ${(cachedShare(whole.usage) * 100).toFixed(1)}%.`);
  if (whole.unpricedTokens > 0) out.push(`${k(whole.unpricedTokens)} tokens of a model the price table doesn't know are left out of the cost.`);
  for (const w of r.warnings) out.push(`Note: ${w}`);
  for (const u of r.unreadable) out.push(`Could not read: ${u}`);
  const split = dollarSplit(r);
  out.push('', '**Where the dollars go**', '', table(['what it paid for', 'cost', 'share'], SPLIT_KEYS.map((x) => [x, usd(split[x]), pct(split[x], whole.cost)])));
  out.push('', '**By person**', '', tableOf(r.turns, 'person', (t) => t.person));
  out.push('', '**By what began the turn**', '', tableOf(r.turns, 'trigger', (t) => t.trigger, TRIGGERS));
  out.push('', '**By what the turn did**', '', tableOf(r.turns, 'work', (t) => t.work, WORKS));
  out.push('', '**By role**', '', tableOf(r.turns, 'role', (t) => roleOfTurn(r, t), ['ceo', 'manager', 'checker', 'maker']));
  out.push('', '**Cache reads by person**', '', cacheReadTable(r.turns, 'person', (t) => t.person));
  out.push('', '**Cache reads by trigger**', '', cacheReadTable(r.turns, 'trigger', (t) => t.trigger));
  out.push('', '**Cache reads by work**', '', cacheReadTable(r.turns, 'work', (t) => t.work));
  const personTrigger = new Map<string, Map<string, number>>();
  for (const t of r.turns) {
    const row = personTrigger.get(t.person) ?? new Map<string, number>();
    row.set(t.trigger, (row.get(t.trigger) ?? 0) + t.cost);
    personTrigger.set(t.person, row);
  }
  const usedTriggers = TRIGGERS.filter((x) => r.turns.some((t) => t.trigger === x));
  out.push('', '**Cost by person and trigger**', '', table(['person', ...usedTriggers, 'all'], [...personTrigger.entries()].map(([p, row]) => [p, ...usedTriggers.map((x) => (row.has(x) ? usd(row.get(x) ?? 0) : '-')), usd([...row.values()].reduce((a, b) => a + b, 0))])));
  out.push('', '**Fixed overhead per desk (the first request)**', '', overheadTable(r));
  out.push('', '**Context size over a session (largest prompt in the turn)**', '', growthTable(r));
  const idle = r.turns.filter((t) => t.work === 'idle');
  const relayOnly = r.turns.filter((t) => t.work === 'relaying');
  out.push('', `Idle turns: ${idle.length} of ${whole.turns} (${usd(idle.reduce((a, t) => a + t.cost, 0))}). Relay-only turns: ${relayOnly.length} (${usd(relayOnly.reduce((a, t) => a + t.cost, 0))}). Reporting-only turns: ${r.turns.filter((t) => t.work === 'reporting').length}.`);
  const mid = r.turns.reduce((a, t) => a + t.folded.length, 0);
  out.push(`Messages folded into a turn already under way: ${mid}.`);
  out.push(...handoverSection([r]));
  out.push('', '**Costliest turns**', '', table(['person', 'turn', 'trigger', 'work', 'requests', 'cache read', 'cost'], [...r.turns].sort((a, b) => b.cost - a.cost).slice(0, 8).map((t) => [t.person, String(t.n), t.trigger, t.work, String(t.calls.length), k(t.usage.cacheRead), usd(t.cost)])));
  return out.join('\n');
}

export function renderSummary(runs: readonly RunReport[]): string {
  const turns = runs.flatMap((r) => r.turns);
  const whole = total(turns);
  const out: string[] = ['## Across runs', '', `${runs.length} runs, ${turns.length} turns, ${usd(whole.cost)} at list prices. Cached share of input ${(cachedShare(whole.usage) * 100).toFixed(1)}%; cache reads cost ${usd(turns.reduce((a, t) => a + (costOf(t.calls[0]?.model ?? 'claude-sonnet-5-5', { ...ZERO_USAGE, cacheRead: t.usage.cacheRead }) ?? 0), 0))}.`, ''];
  const roleOfT = (t: TurnStat): Role => {
    const r = runs.find((x) => x.turns.includes(t));
    return r ? roleOfTurn(r, t) : 'maker';
  };
  out.push('**By role**', '', tableOf(turns, 'role', roleOfT, ['ceo', 'manager', 'checker', 'maker']));
  out.push('', '**By trigger**', '', tableOf(turns, 'trigger', (t) => t.trigger, TRIGGERS));
  out.push('', '**By work**', '', tableOf(turns, 'work', (t) => t.work, WORKS));
  out.push('', '**Cache reads by role**', '', cacheReadTable(turns, 'role', roleOfT));
  out.push('', '**Cache reads by trigger**', '', cacheReadTable(turns, 'trigger', (t) => t.trigger));
  out.push('', '**Cache reads by work**', '', cacheReadTable(turns, 'work', (t) => t.work));
  const split: Record<SplitKey, number> = { 'fixed prompt, re-read': 0, 'working context, re-read': 0, 'cache writes after start-up': 0, 'desk start-up (first request)': 0, output: 0, 'uncached input': 0 };
  for (const r of runs) for (const x of SPLIT_KEYS) split[x] += dollarSplit(r)[x];
  out.push('', '**Where the dollars go**', '', table(['what it paid for', 'cost', 'share'], SPLIT_KEYS.map((x) => [x, usd(split[x]), pct(split[x], whole.cost)])));
  const bands = contextBands(runs);
  const cold = coldTurns(runs);
  out.push('', '**Gap before a turn, and whether its first request found the cache cold**', '', table(['gap since the desk last worked', 'turns', 'cold', 'excess cost of the cold ones'], gapBands(runs).map((b) => [b.band, String(b.turns), String(b.cold), usd(b.excess)])));
  out.push('', `Turns that began on a cold cache (the first request rewrote most of the prompt): ${cold.turns}, ${k(cold.written)} tokens written, ${usd(cold.excess)} more than warm reads would have cost.`);
  out.push(...handoverSection(runs));
  out.push('', '**Requests by prompt size**', '', table(['prompt', 'requests', 'cost', 'share of cost'], bands.map((b) => [b.band, String(b.calls), usd(b.cost), pct(b.cost, whole.cost)])));
  const wk = new Map<string, Map<string, number>>();
  for (const r of runs) {
    for (const t of r.turns) {
      const role = roleOfTurn(r, t);
      if (role !== 'ceo' && role !== 'manager') continue;
      const row = wk.get(t.trigger) ?? new Map<string, number>();
      row.set(t.work, (row.get(t.work) ?? 0) + t.cost);
      wk.set(t.trigger, row);
    }
  }
  const usedWork = WORKS.filter((w) => [...wk.values()].some((row) => row.has(w)));
  out.push('', '**CEO and heads: cost by trigger and work**', '', table(['trigger', ...usedWork, 'all'], [...wk.entries()].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0)).map(([trig, row]) => [trig, ...usedWork.map((w) => (row.has(w) ? usd(row.get(w) ?? 0) : '-')), usd([...row.values()].reduce((x, y) => x + y, 0))])));
  const per = runs.map((r) => {
    const b = total(r.turns);
    const ceo = total(r.turns.filter((t) => roleOfTurn(r, t) === 'ceo'));
    const mgr = total(r.turns.filter((t) => roleOfTurn(r, t) === 'manager'));
    const chk = total(r.turns.filter((t) => roleOfTurn(r, t) === 'checker'));
    const first = r.desks.map((d) => d.desk.first?.prompt ?? 0);
    const idle = r.turns.filter((t) => t.work === 'idle').length;
    return [r.label, String(r.desks.length), String(b.turns), usd(b.cost), k(b.usage.cacheRead), k(b.usage.output), `${(cachedShare(b.usage) * 100).toFixed(0)}%`, pct(ceo.cost, b.cost), pct(mgr.cost, b.cost), pct(chk.cost, b.cost), k(first.reduce((a, c) => a + c, 0) / Math.max(1, first.length)), `${idle}`, usd(coldTurns([r]).excess)];
  });
  out.push('', '**Per run**', '', table(['run', 'desks', 'turns', 'cost', 'cache read', 'output', 'cached', 'CEO', 'heads', 'checkers', 'avg first request', 'idle turns', 'cold rewrites'], per));
  const overhead: Record<string, number> = {};
  let desks = 0;
  for (const r of runs) {
    for (const d of r.desks) {
      desks += 1;
      for (const [name, n] of Object.entries(d.desk.overhead)) overhead[name] = (overhead[name] ?? 0) + n;
    }
  }
  const promptTotal = Object.values(overhead).reduce((a, b) => a + b, 0);
  out.push('', `**What a desk carries before it has done anything** (average over ${desks} desks, ${k(promptTotal / Math.max(1, desks))} tokens; split estimated from characters)`, '', table(['part', 'tokens', 'share'], Object.entries(overhead).sort((a, b) => b[1] - a[1]).map(([name, n]) => [name, k(n / Math.max(1, desks)), pct(n, promptTotal)])));
  const levers = leversOf(runs);
  out.push('', '**Levers, ranked by measured size**', '', table(['lever', 'saved', 'of total', 'basis'], [...levers.items].sort((a, b) => b.saved - a.saved).map((l) => [l.lever, usd(l.saved), pct(l.saved, whole.cost), l.note])));
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------

function main(argv: string[]): number {
  const folders: string[] = [];
  let projects: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--json') json = true;
    else if (a === '--projects') projects = argv[(i += 1)] ?? null;
    else if (a.startsWith('--')) {
      console.error(`Unknown option ${a}. Usage: node scripts/accounting.ts <company folder>... [--projects <claude projects dir>] [--json]`);
      return 2;
    } else folders.push(a);
  }
  if (folders.length === 0) {
    console.error('Usage: node scripts/accounting.ts <company folder>... [--projects <claude projects dir>] [--json]');
    return 2;
  }
  const runs: RunReport[] = [];
  let failed = 0;
  for (const f of folders) {
    try {
      runs.push(analyseRun(f, projects));
    } catch (error) {
      failed += 1;
      console.error(`${f}: ${(error as Error).message}`);
    }
  }
  if (json) {
    const strip = (r: RunReport): unknown => ({
      ...r,
      turns: r.turns.map(({ calls, ...t }) => ({ ...t, requests: calls.length, ctxAvg: calls.length ? calls.reduce((a, c) => a + c.ctx, 0) / calls.length : 0, ctxMax: Math.max(0, ...calls.map((c) => c.ctx)) })),
      summary: {
        total: total(r.turns),
        cachedShare: cachedShare(total(r.turns).usage),
        byPerson: Object.fromEntries(group(r.turns, (t) => t.person)),
        byTrigger: Object.fromEntries(group(r.turns, (t) => t.trigger)),
        byWork: Object.fromEntries(group(r.turns, (t) => t.work)),
        byRole: Object.fromEntries(group(r.turns, (t) => roleOfTurn(r, t))),
        handovers: handoverStats([r]),
        idleTurns: r.turns.filter((t) => t.work === 'idle').length,
        relayOnlyTurns: r.turns.filter((t) => t.work === 'relaying').length,
      },
    });
    console.log(JSON.stringify(runs.length === 1 ? strip(runs[0] as RunReport) : { runs: runs.map(strip), levers: leversOf(runs) }, null, 2));
  } else {
    console.log(runs.map(render).join('\n\n'));
    if (runs.length > 1) console.log(`\n${renderSummary(runs)}`);
  }
  return failed > 0 && runs.length === 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
