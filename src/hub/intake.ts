// What Claude Code on this machine sends the hub: v1's hooks and telemetry from any session in a company's folder, and
// from the desks (with their own token) the org tools over MCP, permission requests and liveness hooks.
import { TESTER_ID } from '../core/harness-shape.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApprovalAsk } from '../core/company.ts';
import { safeId } from '../core/events.ts';
import { HttpError, readBody, send } from '../server/http.ts';
import { isInside } from '../server/office.ts';
import { costEventsFromOtlp } from '../server/otel.ts';
import { permissionAnswer, type PermissionVerdict } from '../runtime/approvals.ts';
import { preToolAnswer } from '../runtime/kill-refusal.ts';
import { plainAnswer, plainVerdict } from '../runtime/plain-approvals.ts';
import { intakeOnly } from './guards.ts';
import type { DeskCaller, NodeHandler } from './seams.ts';
import type { HubContext, OpenSeat } from './seat.ts';

const MB = 1024 * 1024;
/** Waits on an approval this much past its expiry, in case the company's own expiry is late, before the hub says no. */
const EXPIRY_GRACE_MS = 1_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The desk's token: `Authorization: Bearer` (the org tools) or `X-Worklings-Desk` (the desk's hooks). */
export function deskTokenOf(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-worklings-desk'];
  return typeof header === 'string' ? header.trim() : null;
}

/** A desk as its token names it: the company, the person, its checkout or worktree and its own scratch folder. */
interface Desk {
  seat: OpenSeat;
  person: string;
  cwd: string;
  scratch: string | null;
}

/** The company and person a desk token stands for, or null. */
export function deskOf(ctx: HubContext, token: string | null): Desk | null {
  const desk = ctx.tokens.resolve(token);
  const seat = desk ? ctx.byKey(desk.companyId) : undefined;
  return desk && seat ? { seat, person: desk.person, cwd: desk.cwd ?? seat.root, scratch: desk.scratch } : null;
}

/** For the org tools: the caller of an MCP request by its bearer token. */
export function callerOf(ctx: HubContext, token: string): DeskCaller | null {
  const desk = deskOf(ctx, token);
  return desk ? { company: desk.seat.handle, person: desk.person, root: desk.seat.root, cwd: desk.cwd } : null;
}

/** The studio chat's desk, as intake tells it apart (src/hub/studio.ts). */
export interface StudioIntake {
  owns(token: string | null): boolean;
  mcp: NodeHandler;
}

/** A plain session's no when nobody answered: no advice of the office's. */
const PLAIN_EXPIRED = 'Nobody answered this in time, so it counts as a no.';
const CARRY_ON = "Don't try it again; carry on without it, or tell your manager what you need.";
const EXPIRED = "Nobody answered this request in time, so it counts as a no. Don't try it again now; carry on without it, or tell your manager what you need.";
/** The same, with what the ask's advice says to do instead. */
const expiredWith = (fallback: string | undefined): string => (fallback ? `Nobody answered this request in time, so it counts as a no. Don't try it again now. ${fallback}` : EXPIRED);
const UNASKED = "The office couldn't put this request to the stakeholder, so it counts as a no. Tell your manager what you need.";

/** The denial a person reads: the stakeholder's own why when they gave one. */
export const declined = (note: string | null): string => (note?.trim() ? `The stakeholder said no to this: ${note.trim()} ${CARRY_ON}` : `The stakeholder said no to this. ${CARRY_ON}`);

/**
 * Waits for the stakeholder, never past the ask's expiry (and a little grace), and never with a hanging timer. When
 * Claude Code stops waiting first (its hook timed out), `withdraw` takes the approval out of the inbox.
 */
async function decision(seat: OpenSeat, person: string, ask: ApprovalAsk, now: number, withdraw: AbortController): Promise<{ allow: boolean; message: string; plain: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), Math.max(0, ask.expiresAt - now) + EXPIRY_GRACE_MS);
  });
  try {
    const answer = await Promise.race([seat.handle.requestApproval(person, ask, withdraw.signal), expired]);
    if (answer === null) {
      withdraw.abort();
      return { allow: false, message: expiredWith(ask.advice?.fallback), plain: PLAIN_EXPIRED };
    }
    if (answer.decision === 'allow') return { allow: true, message: '', plain: '' };
    const note = answer.note?.trim();
    // A plain session reads the person's own words, as a no in the terminal would give it, and nothing of the office's.
    const plain = answer.expired ? PLAIN_EXPIRED : note ? `The person said no: ${note}` : 'The person said no.';
    return { allow: false, message: answer.expired ? expiredWith(answer.fallback ?? ask.advice?.fallback) : declined(answer.note), plain };
  } catch (error) {
    process.stderr.write(`worklings: an approval for ${person} couldn't be asked: ${error instanceof Error ? error.message : String(error)}\n`);
    return { allow: false, message: UNASKED, plain: "The request couldn't be put to the person, so it counts as a no." };
  } finally {
    clearTimeout(timer);
  }
}

async function permission(ctx: HubContext, req: IncomingMessage, res: ServerResponse, desk: Desk) {
  // Claude Code giving up is heard from the start: a request whose connection closes while its body is still being read
  // never reaches the inbox, and one that closes later takes its approval back out.
  const withdraw = new AbortController();
  const gaveUp = () => {
    if (!res.writableEnded) withdraw.abort();
  };
  res.once('close', gaveUp);
  try {
    const payload = await readBody(req, MB);
    if (!isObj(payload) || payload.hook_event_name !== 'PermissionRequest') throw new HttpError(400, 'Send a PermissionRequest hook payload.');
    const { seat, person, cwd, scratch } = desk;
    const sessionId = safeId(payload.session_id);
    // The scene draws the desk's session as its person from the first thing it does.
    if (sessionId && seat.office.state.assigned[sessionId] === undefined) seat.office.assignSession(sessionId, person);
    const view = seat.handle.view();
    // v0.7: a plain desk's prompts are Claude Code's own, so every one goes to the inbox and the office decides none.
    if (view.shape === 'plain') {
      // Plan first runs with the stdio host, which every prompt also reaches and which alone can approve ExitPlanMode: the
      // switchboard asks the inbox from there, so the hook leaves it be rather than ask twice.
      if (view.launch?.planFirst === true) return send(res, 200, {});
      const plain = plainVerdict(payload);
      if (plain.verdict === 'deny') return send(res, 200, permissionAnswer('deny', plain.message));
      if (withdraw.signal.aborted || res.destroyed) return;
      const at = ctx.now();
      const decided = await decision(seat, person, { ...plain.ask, expiresAt: at + ctx.approvalWaitMs }, at, withdraw);
      if (res.destroyed || res.writableEnded) return;
      return send(res, 200, plainAnswer(decided.allow, decided.plain, { plan: plain.plan, launch: view.launch }));
    }
    let verdict: PermissionVerdict;
    try {
      // What a desk started is its own to stop by process id: its processes are read only for a command that could be such a stop.
      const own = scratch !== null && ctx.make.ownProcesses && ctx.make.stopsByPid?.(payload) ? [...(await ctx.make.ownProcesses(scratch))] : null;
      verdict = ctx.make.classifyPermission(payload, { root: seat.root, cwd, branch: view.branch, rules: [...view.settings.alwaysAllow], scratch, person, leash: view.steering?.people[person]?.leash ?? 'default', ...(own ? { ownProcesses: own } : {}), ...(view.shape === 'harness' && person === TESTER_ID ? { acceptance: true } : {}) });
    } catch (error) {
      process.stderr.write(`worklings: the approvals policy failed on a request from ${person}: ${error instanceof Error ? error.message : String(error)}\n`);
      return send(res, 200, permissionAnswer('deny', UNASKED));
    }
    if (verdict.verdict === 'allow') return send(res, 200, permissionAnswer('allow'));
    if (verdict.verdict === 'deny') return send(res, 200, permissionAnswer('deny', verdict.message));
    // Nobody reads the answer to a request that has gone, so it isn't put to the stakeholder.
    if (withdraw.signal.aborted || res.destroyed) return;
    const now = ctx.now();
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name.slice(0, 120) : 'a tool';
    const ask: ApprovalAsk = { tool, summary: verdict.summary, detail: verdict.detail, kind: verdict.kind, expiresAt: now + ctx.approvalWaitMs, alwaysRule: verdict.alwaysRule, advice: verdict.advice };
    const decided = await decision(seat, person, ask, now, withdraw);
    // Claude Code may have stopped waiting (its hook timed out): then nobody reads the answer.
    if (res.destroyed || res.writableEnded) return;
    send(res, 200, decided.allow ? permissionAnswer('allow') : permissionAnswer('deny', decided.message));
  } finally {
    res.off('close', gaveUp);
  }
}

/** The office a v1 hook belongs to: the company whose desk runs its session, else the one whose folder holds its cwd. */
function hookTarget(ctx: HubContext, payload: unknown): { seat: OpenSeat; person: string | null } | null {
  if (!isObj(payload)) return null;
  const sessionId = safeId(payload.session_id);
  for (const seat of ctx.open()) {
    const person = sessionId ? seat.handle.sessions().get(sessionId) : undefined;
    if (person) return { seat, person };
  }
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
  const seat = cwd ? ctx.open().find((s) => isInside(s.root, cwd)) : undefined;
  return seat ? { seat, person: null } : null;
}

/** An empty 200 at once: Claude Code waits for a hook's answer before it goes on. */
function answered(res: ServerResponse) {
  res.writeHead(200, { 'content-length': '0' });
  res.end();
}

/**
 * Serves intake and the paths Claude Code probes, returning false for everything else. `mcp` is the org tools'
 * handler, mounted after these checks.
 */
export async function intake(ctx: HubContext, req: IncomingMessage, res: ServerResponse, path: string, mcp: NodeHandler, studio?: StudioIntake): Promise<boolean> {
  // A desk with a missing token looks for OAuth after its 401: answer at once, never with the web app.
  if (path.startsWith('/.well-known/') || path === '/register') throw new HttpError(404, 'Not found.');
  if (path === '/mcp') {
    if (req.method !== 'POST' && req.method !== 'DELETE') throw new HttpError(405, 'The org tools take POST.');
    intakeOnly(req);
    const token = deskTokenOf(req);
    // v0.3: the studio chat's desk reaches its own tools, never a company's org tools.
    if (studio?.owns(token)) {
      await studio.mcp(req, res);
      return true;
    }
    if (!deskOf(ctx, token)) {
      res.writeHead(401, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'www-authenticate': `Bearer realm="worklings-org"${token === null ? '' : ', error="invalid_token"'}`,
      });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -31001, message: "This desk's token is missing or wrong." } }));
      return true;
    }
    await mcp(req, res);
    return true;
  }
  if (path === '/desk/refuse') {
    // v0.7: a plain desk's PreToolUse on Bash and PowerShell: a machine-wide kill is refused, anything else goes on as
    // Claude Code decides (an empty answer).
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    intakeOnly(req);
    if (!deskOf(ctx, deskTokenOf(req))) throw new HttpError(403, "This needs a desk's own token.", { code: 'desk-token' });
    send(res, 200, preToolAnswer(await readBody(req, MB)));
    return true;
  }
  if (path === '/desk/permission' || path === '/desk/hook') {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    intakeOnly(req);
    // v0.3: the studio chat's desk has no tool that asks, so anything it asks is a no; its liveness hooks are just heard.
    if (studio?.owns(deskTokenOf(req))) {
      await readBody(req, MB);
      if (path === '/desk/permission') send(res, 200, permissionAnswer('deny', 'The studio chat reads and relays only; it has no tools that change anything.'));
      else answered(res);
      return true;
    }
    const desk = deskOf(ctx, deskTokenOf(req));
    if (!desk) throw new HttpError(403, "This needs a desk's own token.", { code: 'desk-token' });
    if (path === '/desk/permission') {
      await permission(ctx, req, res, desk);
      return true;
    }
    const payload = await readBody(req, MB);
    answered(res);
    desk.seat.office.ingestDeskHook(payload, desk.person);
    return true;
  }
  if (req.method === 'POST' && (path === '/hooks' || path === '/otel/v1/logs')) {
    intakeOnly(req);
    if (path === '/hooks') {
      const payload = await readBody(req, MB);
      answered(res);
      const target = hookTarget(ctx, payload);
      if (target?.person) target.seat.office.ingestDeskHook(payload, target.person);
      else target?.seat.office.ingestHook(payload);
      return true;
    }
    if (!(req.headers['content-type'] ?? '').includes('json')) throw new HttpError(415, 'Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json; protobuf is not supported.');
    const events = costEventsFromOtlp(await readBody(req, 4 * MB), ctx.now());
    for (const seat of ctx.open()) seat.office.ingestCosts(events);
    send(res, 200, {});
    return true;
  }
  return false;
}
