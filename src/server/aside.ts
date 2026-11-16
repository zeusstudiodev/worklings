// Ask aside and Catch me up: the office's own calls to the person's Claude Code, made only when the person asks. One
// call at a time and a few a minute, from a neutral empty folder (no project settings, hooks or CLAUDE.md load there),
// through the read-only runner in claude.ts. The lead of a live session answers through a fork of its session; everyone
// else (and the lead in a replay) through a fresh call that reads their own transcript. The demo makes up its answers.
// Nothing here logs a question, an answer or a transcript.
import { randomBytes, randomUUID } from 'node:crypto';
import { constants, existsSync, mkdtempSync } from 'node:fs';
import { lstat, open, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ANSWER_MAX_CHARS, ASIDE_ANSWERS_KEPT, type AsideAnswer, type AsideCall, type AsideFailure, type AsideView, ASK_MODEL, askEstimate,
  askRoute, CATCH_UP_SYSTEM_PROMPT, catchUpEstimate, catchUpPrompt, catchUpSince, cleanQuestion, type Digest, DIGESTS_KEPT, emptySpend,
  BUSY_MESSAGE, type Estimate, estimatedUsage, forkPrompt, type OfficeSpend, personSystemPrompt, SUGGESTED_QUESTIONS, suggestedIndex,
  transcriptPrompt,
} from '../core/aside.ts';
import { type Account, catchUpAccount } from '../core/digest.ts';
import { EXCERPT_BUDGET, transcriptExcerpt } from '../core/excerpt.ts';
import type { AgentKind, AgentState } from '../core/office.ts';
import { costOf } from '../core/pricing.ts';
import { redactClip } from '../core/redact.ts';
import { addUsage, type TokenUsage, totalTokens } from '../core/usage.ts';
import { nameInSentence, severalLeads } from '../core/words.ts';
import { demoAnswer, demoDigest } from './aside-demo.ts';
import { ClaudeError, type ClaudeResult, DEFAULT_TIMEOUT_MS, runClaude, type RunClaudeOptions, timedOut } from './claude.ts';
import type { Office } from './office.ts';
import { transcriptDir } from './replay.ts';

export interface AsideOptions {
  /** Runs Claude Code: runClaude unless a test passes its own. */
  run?: (options: RunClaudeOptions) => Promise<ClaudeResult>;
  /** The environment Claude Code starts from (process.env when not given); tests point WORKLINGS_CLAUDE at a fake. */
  env?: NodeJS.ProcessEnv;
  /** The real clock. */
  now?: () => number;
  /** How long a call may take (runClaude's 60 s when not given). */
  timeoutMs?: number;
  /** How long a demo sample takes to "think" (about 2 s). */
  sampleMs?: number;
  /** Where the neutral working folder is made (the system temp folder when not given). */
  workRoot?: string;
}

export type AsideRefusalCode = 'bad-input' | 'unknown-agent' | 'busy' | 'rate-limited' | 'closed';

/** A request the office turns down before any call: the HTTP layer sends `status` with the message. */
export class AsideRefusal extends Error {
  readonly status: number;
  readonly code: AsideRefusalCode;
  /** For rate-limited: seconds until a call is allowed again. */
  readonly retryAfter: number | null;

  constructor(status: number, code: AsideRefusalCode, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = 'AsideRefusal';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface AsideReply {
  status: number;
  body: unknown;
}

/** Calls in any minute, so a stuck button or a script can't run up the person's bill. */
export const CALLS_PER_MINUTE = 6;
const MINUTE_MS = 60_000;
const SAMPLE_MS = 2_000;
/** A transcript bigger than both is read from its start (the brief) and its end (the latest steps). */
const READ_HEAD = 256 * 1024;
const READ_TAIL = 4 * 1024 * 1024;

const CANCELLED: AsideFailure = { code: 'cancelled', message: 'Cancelled.', detail: null };
/** Why a call's signal fired when its deadline, not the person, stopped it. */
const DEADLINE = Symbol('deadline');

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

const missing = (error: unknown) => error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** `folder` (any slash style, any case on Windows) where it is a whole folder in `text`, replaced by `label`. */
function replaceFolder(text: string, folder: string, label: string): string {
  let out = text;
  for (const variant of new Set([folder, folder.replaceAll('\\', '/'), folder.replaceAll('/', '\\')])) {
    const pattern = new RegExp(`${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, process.platform === 'win32' ? 'gi' : 'g');
    out = out.replace(pattern, label);
  }
  return out;
}

/** An absolute path (a drive, a share, under ~ or a folder of /) up to a space or a quote. */
const LOCAL_PATH = /(?:\b[A-Za-z]:[\\/]|\\\\|~[\\/]|(?<![\w.:/~-])\/(?=[^\s'"/]+\/))[^\s'"<>|*?]*/g;

/** A path's last part, with the punctuation that ended its sentence: "C:\Users\me\claude.exe." -> "claude.exe.". */
function lastPart(path: string): string {
  let end = path.length;
  while (end > 0 && '.,;:)]'.includes(path.charAt(end - 1))) end -= 1;
  const parts = path.slice(0, end).split(/[\\/]/).filter(Boolean);
  return `${parts.at(-1) ?? ''}${path.slice(end)}`;
}

/**
 * A failure as the screen shows it: local paths cut to their last part (the user's home folder first, so no user name
 * stays behind), secrets masked, at most `max` characters. The terminal is where full paths belong.
 */
function shownFailure(text: string, max: number): string {
  const home = homedir();
  const named = home.length > 3 ? replaceFolder(text.slice(0, 2_000), home, '~') : text.slice(0, 2_000);
  return redactClip(named.replace(LOCAL_PATH, lastPart), max);
}

/** A promise that gives up when `signal` fires: what it was waiting on finishes (or fails) on its own, unheard. */
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new ClaudeError('cancelled', 'Cancelled before Claude Code answered.'));
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** What a question needs about the person, taken when it is asked: the office moves on while the call runs. */
interface Askee {
  key: string;
  kind: AgentKind;
  roleId: string | null;
  sessionId: string;
  /** "QA engineer", as the office shows it. */
  name: string;
  agentType: string;
  /** How sentences name them: "the QA engineer", "the lead in session 3f2a1c", "the Explore agent". */
  called: string;
  /** Who the demo's samples are for: "lead" or the agent type. */
  person: string;
  /** Their transcript, when the office may read it: a .jsonl file in Claude Code's projects folder. */
  transcript: string | null;
  cwd: string | null;
}

interface Running {
  call: AsideCall;
  controller: AbortController;
  done: Promise<void>;
}

/**
 * Reads a transcript, capped: the first 256 KB and the last 4 MB of a bigger file. Null when there is no regular file
 * there: a link (to wherever it points), a folder, a pipe that would never end or a device is never read.
 */
async function readCapped(path: string): Promise<string | null> {
  let handle;
  try {
    if (!(await lstat(path)).isFile()) return null;
    // No following a link put there since, and no waiting on a pipe; these flags don't exist on Windows.
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (missing(error) || (error instanceof Error && 'code' in error && error.code === 'ELOOP')) return null;
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    const size = stats.size;
    if (size <= READ_HEAD + READ_TAIL) return await handle.readFile('utf8');
    const head = Buffer.alloc(READ_HEAD);
    const tail = Buffer.alloc(READ_TAIL);
    const first = await handle.read(head, 0, READ_HEAD, 0);
    const last = await handle.read(tail, 0, READ_TAIL, size - READ_TAIL);
    // The cut lines on either side don't parse, and the excerpt skips them.
    return `${head.subarray(0, first.bytesRead).toString('utf8')}\n${tail.subarray(0, last.bytesRead).toString('utf8')}`;
  } finally {
    await handle.close();
  }
}

/** The `modelUsage` of a transcript line, wherever the line keeps it. */
function modelUsageIn(value: unknown, depth = 0): Fields | null {
  if (!isObject(value) || depth > 3) return null;
  if (isObject(value.modelUsage)) return value.modelUsage;
  for (const child of Object.values(value)) {
    const found = modelUsageIn(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** What a session's transcript last recorded it had cost: a fork's total_cost_usd starts from that. */
async function recordedCost(path: string): Promise<number> {
  const text = await readCapped(path);
  const lines = text?.split('\n') ?? [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.includes('"modelUsage"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // half a line where the read was cut: look further back
    }
    const usage = modelUsageIn(entry);
    if (!usage) continue;
    let cost = 0;
    for (const model of Object.values(usage)) {
      const value = isObject(model) ? model.costUSD : undefined;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) cost += value;
    }
    return cost;
  }
  return 0;
}

function readAsk(body: unknown): { agentKey: string; question: string } {
  if (!isObject(body) || typeof body.agentKey !== 'string' || body.agentKey.length === 0 || body.agentKey.length > 300) {
    throw new AsideRefusal(400, 'bad-input', 'Say who to ask and what: {"agentKey": "...", "question": "..."}.');
  }
  const cleaned = cleanQuestion(body.question);
  if ('error' in cleaned) throw new AsideRefusal(400, 'bad-input', cleaned.error);
  return { agentKey: body.agentKey, question: cleaned.question };
}

/** The office's Ask aside and Catch me up: one per office, in every mode. */
export class Aside {
  private running: Running | null = null;
  private answers: AsideAnswer[] = [];
  private digests: Digest[] = [];
  private spend: OfficeSpend = emptySpend();
  private lastCatchUpAt: number | null = null;
  /** When recent calls started, for the per-minute limit. */
  private starts: number[] = [];
  private workDir: string | null = null;
  /** The replayed session the digests belong to: another one clears them. */
  private replaySession: string | null = null;
  /** The next catch-up as snapshots show it, made at most once a second: the account takes a few milliseconds. */
  private nextCatchUp: { at: number; key: string; second: number | null; value: AsideView['catchUp'] } | null = null;
  private closed = false;
  private readonly office: Office;
  private readonly options: AsideOptions;
  private readonly run: (options: RunClaudeOptions) => Promise<ClaudeResult>;
  private readonly now: () => number;

  constructor(office: Office, options: AsideOptions = {}) {
    this.office = office;
    this.options = options;
    this.run = options.run ?? runClaude;
    this.now = options.now ?? Date.now;
  }

  /** What the snapshot carries: the running call, answers, digests, the next catch-up and the office's spend. */
  view(): AsideView {
    this.followReplay();
    return {
      running: this.running ? { ...this.running.call } : null,
      answers: this.answers.slice(),
      digests: this.digests.slice(),
      catchUp: this.catchUpView(),
      spend: { ...this.spend },
    };
  }

  /** Where the next catch-up starts, its estimate and whether anything is new; at most a second old. */
  private catchUpView(): AsideView['catchUp'] {
    const now = this.now();
    const key = `${this.lastCatchUpAt}:${this.replaySession}`;
    // A replay's position is its clock, to the second. A seek (while paused) or a jump back shows at once; while it
    // plays forward, at most once a second of real time, like the live office: a playing replay moves every 100 ms, and
    // the account is too costly to rebuild for every snapshot.
    const replay = this.office.mode === 'replay' ? this.office.replay : null;
    const second = replay ? Math.floor(replay.position / 1000) : null;
    const cached = this.nextCatchUp;
    const recent = cached !== null && cached.key === key && now - cached.at >= 0 && now - cached.at < 1000;
    const sameMoment = cached !== null && (second === cached.second || (replay?.playing === true && cached.second !== null && second !== null && second > cached.second));
    if (cached && recent && sameMoment) return cached.value;
    const until = this.clock();
    const since = catchUpSince(this.lastCatchUpAt, until, this.firstSeen());
    const account = this.account(since, until);
    const value = { since, estimate: this.office.mode === 'demo' ? null : catchUpEstimate(account.text.length), nothingNew: account.nothingNew };
    this.nextCatchUp = { at: now, key, second, value };
    return value;
  }

  /** POST /api/ask: answers come in later snapshots. */
  ask(body: unknown): AsideReply {
    this.refuseIfClosed();
    const { agentKey, question } = readAsk(body);
    const agents = this.office.state.agents;
    const agent = Object.hasOwn(agents, agentKey) ? agents[agentKey] : undefined;
    if (!agent) throw new AsideRefusal(404, 'unknown-agent', "That person isn't in the office.");
    this.followReplay();
    this.refuseIfBusy();
    const route = askRoute(agent, this.office.mode);
    if (route !== 'sample') this.refuseIfRateLimited();
    const askee = this.askee(agent);
    const asOf = this.office.mode === 'replay' ? this.clock() : null;
    // The demo's reads need no token, so a question typed there isn't kept: only the suggested ones are.
    const suggested = route === 'sample' ? (SUGGESTED_QUESTIONS[suggestedIndex(question)] ?? null) : question;
    const call: AsideCall = {
      id: randomUUID(), kind: 'ask', agentKey: agent.key, roleId: agent.roleId, who: agent.name, question: suggested, startedAt: this.now(),
      estimate: askEstimate(agent, this.office.mode),
    };
    this.begin(call, (signal) => this.answer(call, askee, route, question, asOf, signal));
    return { status: 202, body: { id: call.id } };
  }

  /** POST /api/catch-up: 202 while it is written, or 200 with a digest when nothing new happened (no call). */
  catchUp(body: unknown): AsideReply {
    this.refuseIfClosed();
    if (!isObject(body)) throw new AsideRefusal(400, 'bad-input', 'Send an empty JSON object: {}.');
    this.followReplay();
    this.refuseIfBusy();
    const until = this.clock();
    const firstSeen = this.firstSeen();
    const account = this.account(catchUpSince(this.lastCatchUpAt, until, firstSeen), until);
    if (account.nothingNew) {
      const digest: Digest = {
        id: randomUUID(), since: account.since, until, at: this.now(), source: 'nothing-new', text: null, failure: null, cost: 0, tokens: 0, estimated: false,
      };
      return { status: 200, body: digest };
    }
    const demo = this.office.mode === 'demo';
    if (!demo) this.refuseIfRateLimited();
    // A failed catch-up shows until the next one starts.
    this.digests = this.digests.filter((d) => d.failure === null);
    const call: AsideCall = {
      id: randomUUID(), kind: 'catch-up', agentKey: null, roleId: null, who: null, question: null, startedAt: this.now(),
      estimate: demo ? null : catchUpEstimate(account.text.length),
    };
    const loopSeconds = (until - (firstSeen ?? until)) / 1000;
    this.begin(call, (signal) => this.digest(call, account, demo ? loopSeconds : null, signal));
    return { status: 202, body: { id: call.id } };
  }

  /** POST /api/aside/cancel: stops the running call if it is the one named. */
  cancel(body: unknown): AsideReply {
    const id = isObject(body) && typeof body.id === 'string' ? body.id : null;
    if (!id) throw new AsideRefusal(400, 'bad-input', 'Say which call to cancel: {"id": "..."}.');
    const running = this.running;
    if (!running || running.call.id !== id) return { status: 200, body: { cancelled: false } };
    running.controller.abort();
    return { status: 200, body: { cancelled: true } };
  }

  /** Resolves once no call is running. */
  async settled(): Promise<void> {
    while (this.running) await this.running.done;
  }

  /** Stops the running call, refuses new ones and removes the working folder. */
  async close(): Promise<void> {
    this.closed = true;
    this.running?.controller.abort();
    await this.settled();
    if (!this.workDir) return;
    try {
      await rm(this.workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      process.stderr.write(`worklings: couldn't remove ${this.workDir}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    this.workDir = null;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /** The office's clock: the replay position in a replay, real time otherwise. */
  private clock(): number {
    return this.office.mode === 'replay' && this.office.replay ? this.office.replay.position : this.now();
  }

  private firstSeen(): number | null {
    let first: number | null = null;
    for (const s of Object.values(this.office.state.sessions)) if (first === null || s.startedAt < first) first = s.startedAt;
    return first;
  }

  private account(since: number, until: number): Account {
    const { state, studio } = this.office;
    return catchUpAccount(
      {
        studioName: studio?.name ?? this.office.name, agents: Object.values(state.agents), sessions: Object.values(state.sessions),
        activity: state.activity, gateRuns: state.gateRuns, studio,
      },
      since,
      until,
    );
  }

  /** Another replayed session starts the catch-ups over. */
  private followReplay() {
    if (this.office.mode !== 'replay') return;
    const session = this.office.replay?.sessionId ?? null;
    if (session === this.replaySession) return;
    this.replaySession = session;
    this.digests = [];
    this.lastCatchUpAt = null;
  }

  private refuseIfClosed() {
    if (this.closed) throw new AsideRefusal(503, 'closed', 'The office is closing.');
  }

  private refuseIfBusy() {
    if (this.running) throw new AsideRefusal(409, 'busy', BUSY_MESSAGE);
  }

  private refuseIfRateLimited() {
    const now = this.now();
    this.starts = this.starts.filter((at) => at > now - MINUTE_MS);
    const oldest = this.starts[0];
    if (this.starts.length < CALLS_PER_MINUTE || oldest === undefined) return;
    const wait = Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1000));
    throw new AsideRefusal(429, 'rate-limited', `The office takes a few calls a minute. Try again in ${wait} second${wait === 1 ? '' : 's'}.`, wait);
  }

  /** Where a question to `agent` reads from: their own transcript (a subagent's file sits beside the session's). */
  private transcriptOf(agent: AgentState): string | null {
    let path: string;
    if (this.office.mode === 'replay') {
      const dir = transcriptDir(this.office.root, this.office.claudeDir);
      path = agent.agentId ? join(dir, agent.sessionId, 'subagents', `agent-${agent.agentId}.jsonl`) : join(dir, `${agent.sessionId}.jsonl`);
    } else {
      const main = this.office.state.sessions[agent.sessionId]?.transcriptPath;
      if (!main) return null;
      path = agent.agentId ? join(dirname(main), agent.sessionId, 'subagents', `agent-${agent.agentId}.jsonl`) : main;
    }
    return this.office.isTranscript(path) ? path : null;
  }

  private askee(agent: AgentState): Askee {
    return {
      key: agent.key, kind: agent.kind, roleId: agent.roleId, sessionId: agent.sessionId, name: agent.name, agentType: agent.agentType,
      called: nameInSentence(agent, severalLeads(Object.values(this.office.state.agents))),
      person: agent.kind === 'lead' ? 'lead' : agent.agentType, transcript: this.transcriptOf(agent),
      cwd: this.office.state.sessions[agent.sessionId]?.cwd ?? null,
    };
  }

  /** The empty folder every call runs in, made on first use (and again if something cleared it). */
  private workFolder(): string {
    if (this.workDir && existsSync(this.workDir)) return this.workDir;
    this.workDir = mkdtempSync(join(this.options.workRoot ?? tmpdir(), 'worklings-ask-'));
    return this.workDir;
  }

  private timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private call(args: string[], input: string, signal: AbortSignal): Promise<ClaudeResult> {
    this.starts.push(this.now());
    // The call's own deadline (see begin) stops it first; the runner's timeout is a backstop.
    return this.run({ args, input, cwd: this.workFolder(), signal, env: this.options.env, timeoutMs: this.timeoutMs() });
  }

  /** Runs `work` as the one call in flight, stopped by Cancel or by its deadline, which covers reading a transcript too. */
  private begin(call: AsideCall, work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(DEADLINE), this.timeoutMs());
    const running: Running = { call, controller, done: Promise.resolve() };
    this.running = running;
    running.done = work(controller.signal)
      .catch((error: unknown) => {
        // Each call records its own failures; reaching here is a bug in the office, so it goes to the terminal.
        process.stderr.write(`worklings: a ${call.kind === 'ask' ? 'question' : 'catch-up'} ended badly: ${error instanceof Error ? error.message : String(error)}\n`);
      })
      .finally(() => {
        clearTimeout(deadline);
        if (this.running === running) this.running = null;
        this.office.markDirty();
      });
    this.office.markDirty();
  }

  /** Waits like a model would, for the demo: true when the time passed, false when cancelled. */
  private pause(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      const done = (passed: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(passed);
      };
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(true), this.options.sampleMs ?? SAMPLE_MS);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** A Claude Code failure as the screen shows it: no local paths, secrets masked. */
  private shown(error: ClaudeError): AsideFailure {
    return { code: error.code, message: shownFailure(error.message, 300), detail: error.detail === null ? null : shownFailure(error.detail, 160) };
  }

  /** Why a call stopped before it was done: its deadline, or the person. */
  private stopped(signal: AbortSignal): AsideFailure {
    return signal.reason === DEADLINE ? this.shown(timedOut(this.timeoutMs())) : CANCELLED;
  }

  private failureOf(error: unknown, signal: AbortSignal): AsideFailure {
    if (signal.aborted) return this.stopped(signal);
    if (error instanceof ClaudeError) return this.shown(error);
    // Not Claude Code's doing (a transcript the office couldn't read, say): the terminal gets the details.
    process.stderr.write(`worklings: the office couldn't ask Claude Code: ${error instanceof Error ? error.message : String(error)}\n`);
    return { code: 'failed', message: "The office couldn't ask Claude Code. The terminal it runs in says why.", detail: null };
  }

  private charge(kind: 'questions' | 'catchUps', usage: TokenUsage, cost: number) {
    this.spend = { ...this.spend, [kind]: this.spend[kind] + 1, cost: this.spend.cost + cost, tokens: this.spend.tokens + totalTokens(usage), usage: addUsage(this.spend.usage, usage) };
  }

  /**
   * What a call that failed costs. Calls that never reached Claude Code cost nothing; timed-out and cancelled ones count
   * at their estimate, since Claude Code doesn't report what they used; the rest at nothing (Claude Code reports no
   * usage for an error).
   */
  private chargeFailure(
    kind: 'questions' | 'catchUps',
    reached: boolean,
    failure: AsideFailure,
    estimate: Estimate | null,
  ): { cost: number; tokens: number; estimated: boolean } {
    if (!reached || failure.code === 'not-installed') return { cost: 0, tokens: 0, estimated: false };
    const stopped = failure.code === 'timed-out' || failure.code === 'cancelled';
    const spent = estimatedUsage(stopped ? estimate : null);
    this.charge(kind, spent.usage, spent.cost);
    // Said wherever it shows ("1 at its estimate"), so an estimate never passes for what Claude Code reported.
    const estimated = stopped && estimate !== null;
    if (estimated) this.spend = { ...this.spend, estimated: this.spend.estimated + 1 };
    return { cost: spent.cost, tokens: spent.tokens, estimated };
  }

  private record(answer: AsideAnswer) {
    this.answers.push(answer);
    if (this.answers.length > ASIDE_ANSWERS_KEPT) this.answers.splice(0, this.answers.length - ASIDE_ANSWERS_KEPT);
  }

  private keep(digest: Digest) {
    this.digests = [digest, ...this.digests].slice(0, DIGESTS_KEPT);
  }

  /** A fork is priced from its own usage: its total_cost_usd also counts what the session had cost before. */
  private async forkCost(result: ClaudeResult, askee: Askee): Promise<number> {
    const priced = costOf(result.model ?? ASK_MODEL, result.usage);
    if (priced !== null) return priced;
    const before = askee.transcript ? await recordedCost(askee.transcript) : 0;
    return Math.max(0, (result.reportedCostUsd ?? 0) - before);
  }

  private async answer(call: AsideCall, askee: Askee, route: 'fork' | 'transcript' | 'sample', question: string, asOf: number | null, signal: AbortSignal) {
    const base = {
      id: call.id, agentKey: askee.key, roleId: askee.roleId, sessionId: askee.sessionId, who: askee.name, question: call.question, askedAt: call.startedAt, asOf,
    };
    if (route === 'sample') {
      this.spend = { ...this.spend, samples: this.spend.samples + 1 };
      const passed = await this.pause(signal);
      this.record({
        ...base, answeredAt: this.now(), source: 'sample', text: passed ? demoAnswer(askee.person, question) : null, failure: passed ? null : this.stopped(signal),
        cost: 0, tokens: 0, estimated: false,
      });
      return;
    }
    let reached = false;
    try {
      let result: ClaudeResult;
      let cost: number;
      if (route === 'fork') {
        // Cancelled before it starts, the runner refuses without starting anything: that costs nothing.
        reached = !signal.aborted;
        result = await this.call(['--resume', askee.sessionId, '--fork-session'], forkPrompt(question), signal);
        cost = await this.forkCost(result, askee);
      } else {
        // The deadline and Cancel cover the read too: a transcript on a slow or stuck drive can't hold the office.
        const text = askee.transcript ? await unlessAborted(readCapped(askee.transcript), signal) : null;
        const until = asOf ?? this.now();
        const excerpt = text === null ? null : transcriptExcerpt(text, { who: askee.name, lead: askee.kind === 'lead', until, budgetChars: EXCERPT_BUDGET, ...(askee.cwd ? { cwd: askee.cwd } : {}) });
        if (!excerpt || excerpt.empty) {
          const failure: AsideFailure = {
            code: 'no-transcript', message: `The office can't find ${askee.called}'s transcript on this machine, so there's nothing to answer from.`, detail: null,
          };
          this.record({ ...base, answeredAt: this.now(), source: 'transcript', text: null, failure, cost: 0, tokens: 0, estimated: false });
          return;
        }
        reached = !signal.aborted;
        const code = randomBytes(6).toString('hex');
        result = await this.call(['--system-prompt', personSystemPrompt(askee.called, askee.kind === 'lead')], transcriptPrompt(excerpt.text, question, code), signal);
        cost = result.reportedCostUsd ?? costOf(result.model ?? ASK_MODEL, result.usage) ?? 0;
      }
      this.charge('questions', result.usage, cost);
      this.record({
        ...base, answeredAt: this.now(), source: route, text: redactClip(result.text.trim(), ANSWER_MAX_CHARS), failure: null, cost,
        tokens: totalTokens(result.usage), estimated: false,
      });
    } catch (error) {
      const failure = this.failureOf(error, signal);
      const spent = this.chargeFailure('questions', reached, failure, call.estimate);
      this.record({ ...base, answeredAt: this.now(), source: route, text: null, failure, ...spent });
    }
  }

  /** `demoSeconds` is where the demo's loop is, for its sample; null when Claude Code writes the digest. */
  private async digest(call: AsideCall, account: Account, demoSeconds: number | null, signal: AbortSignal) {
    const replayed = this.replaySession;
    const base = { id: call.id, since: account.since, until: account.until };
    // A digest of a replayed session that is no longer on screen is dropped (its cost still counts).
    const current = () => {
      this.followReplay();
      return this.replaySession === replayed;
    };
    if (demoSeconds !== null) {
      this.spend = { ...this.spend, samples: this.spend.samples + 1 };
      const passed = await this.pause(signal);
      if (passed) this.lastCatchUpAt = account.until;
      this.keep({ ...base, at: this.now(), source: 'sample', text: passed ? demoDigest(demoSeconds) : null, failure: passed ? null : this.stopped(signal), cost: 0, tokens: 0, estimated: false });
      return;
    }
    let reached = false;
    try {
      const code = randomBytes(6).toString('hex');
      reached = !signal.aborted;
      const result = await this.call(['--system-prompt', CATCH_UP_SYSTEM_PROMPT], catchUpPrompt(account.text, code), signal);
      const cost = result.reportedCostUsd ?? costOf(result.model ?? ASK_MODEL, result.usage) ?? 0;
      this.charge('catchUps', result.usage, cost);
      if (!current()) return;
      this.lastCatchUpAt = account.until;
      this.keep({ ...base, at: this.now(), source: 'model', text: redactClip(result.text.trim(), ANSWER_MAX_CHARS), failure: null, cost, tokens: totalTokens(result.usage), estimated: false });
    } catch (error) {
      const failure = this.failureOf(error, signal);
      const spent = this.chargeFailure('catchUps', reached, failure, call.estimate);
      if (current()) this.keep({ ...base, at: this.now(), source: 'model', text: null, failure, ...spent });
    }
  }
}
