// Who costs what: per-role and per-room totals and the advice the payroll board gives.
import type { OfficeSpend } from './aside.ts';
import { type AgentState, agentCost, type ArchivedPerson, payrollId } from './office.ts';
import type { Studio } from './studio.ts';
import { addUsage, type TokenUsage, totalTokens, ZERO_USAGE } from './usage.ts';

export interface PayrollLine {
  /** Role id, contractor agent type, "lead", or "office" for the office's own questions and catch-ups. */
  id: string;
  title: string;
  /** "office" is the office's own spend: always the last line, in no room, never given advice. */
  kind: 'lead' | 'role' | 'contractor' | 'office';
  department: string | null;
  usage: TokenUsage;
  tokens: number;
  cost: number;
  requests: number;
  toolCalls: number;
  toolErrors: number;
  filesChanged: number;
  /** Separate times the role was called (each subagent spawn counts once). */
  shifts: number;
  share: number;
}

export interface RoomLine {
  id: string;
  name: string;
  cost: number;
  tokens: number;
  share: number;
}

export type AdviceKind = 'idle' | 'expensive' | 'failing';

export interface Advice {
  roleId: string;
  /** Every role the advice is about (several for idle desks). */
  roleIds: string[];
  kind: AdviceKind;
  message: string;
}

/** API requests across the studio before idle desks are worth pointing out. */
export const IDLE_AFTER_REQUESTS = 5;

export interface Payroll {
  lines: PayrollLine[];
  rooms: RoomLine[];
  idle: string[];
  advice: Advice[];
  total: { cost: number; tokens: number };
}

/** The office's own line, from its first question, catch-up or demo sample. */
function officeLine(spend: OfficeSpend | undefined): PayrollLine | null {
  const calls = spend ? spend.questions + spend.catchUps + spend.samples : 0;
  if (!spend || calls === 0) return null;
  return {
    id: 'office', title: 'The office', kind: 'office', department: null, usage: spend.usage, tokens: spend.tokens, cost: spend.cost,
    requests: spend.questions + spend.catchUps, toolCalls: 0, toolErrors: 0, filesChanged: 0, shifts: calls, share: 0,
  };
}

/**
 * `archived` holds what people cost in sessions the office has let go of (see `evict`); `office` is what the office
 * itself spent on questions and catch-ups, which counts in the total and the shares but stays out of rooms and advice.
 */
export function payroll(agents: AgentState[], studio: Studio | null, archived: ArchivedPerson[] = [], office?: OfficeSpend): Payroll {
  const roles = new Map(studio?.roles.map((r) => [r.id, r]) ?? []);
  const lines = new Map<string, PayrollLine>();
  const lineOf = (id: string, title: string, kind: PayrollLine['kind']) => {
    let line = lines.get(id);
    if (!line) {
      line = {
        id, title, kind, department: kind === 'role' ? (roles.get(id)?.department ?? null) : null, usage: ZERO_USAGE, tokens: 0,
        cost: 0, requests: 0, toolCalls: 0, toolErrors: 0, filesChanged: 0, shifts: 0, share: 0,
      };
      lines.set(id, line);
    }
    return line;
  };
  for (const a of agents) {
    const line = lineOf(payrollId(a), a.name, a.kind);
    line.usage = addUsage(line.usage, a.usage);
    line.tokens += totalTokens(a.usage);
    line.cost += agentCost(a);
    line.requests += a.requests;
    line.toolCalls += a.toolCalls;
    line.toolErrors += a.toolErrors;
    line.filesChanged += a.files.length;
    line.shifts += 1;
  }
  for (const p of archived) {
    const line = lineOf(p.id, p.name, p.kind);
    line.usage = addUsage(line.usage, p.usage);
    line.tokens += totalTokens(p.usage);
    line.cost += p.cost;
    line.requests += p.requests;
    line.toolCalls += p.toolCalls;
    line.toolErrors += p.toolErrors;
    line.filesChanged += p.filesChanged;
    line.shifts += p.shifts;
  }
  const all = [...lines.values()];
  const own = officeLine(office);
  const counted = own ? [...all, own] : all;
  const totalCost = counted.reduce((s, l) => s + l.cost, 0);
  const totalTokensUsed = counted.reduce((s, l) => s + l.tokens, 0);
  for (const l of counted) l.share = totalCost > 0 ? l.cost / totalCost : totalTokensUsed > 0 ? l.tokens / totalTokensUsed : 0;
  const kindRank = { role: 0, lead: 1, contractor: 2, office: 3 };
  all.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || kindRank[a.kind] - kindRank[b.kind] || a.id.localeCompare(b.id));

  const rooms: RoomLine[] = (studio?.departments ?? []).map((d) => {
    const inRoom = all.filter((l) => l.department === d.id);
    const cost = inRoom.reduce((s, l) => s + l.cost, 0);
    const tokens = inRoom.reduce((s, l) => s + l.tokens, 0);
    return { id: d.id, name: d.name, cost, tokens, share: totalCost > 0 ? cost / totalCost : 0 };
  });

  const idle = (studio?.roles ?? []).filter((r) => !lines.has(r.id)).map((r) => r.id);
  const requests = all.reduce((s, l) => s + l.requests, 0);
  const advice: Advice[] = [];
  // Idle desks only mean something once work has happened, and one line says it better than one per role.
  if (idle.length > 0 && requests >= IDLE_AFTER_REQUESTS) {
    advice.push({
      roleId: idle[0] ?? '',
      roleIds: idle,
      kind: 'idle',
      message: `${idle.length === 1 ? "Hasn't" : "Haven't"} worked yet. If that stays true, fire ${idle.length === 1 ? 'it' : 'them'}: every role's description rides along in each request the lead makes.`,
    });
  }
  for (const l of all) {
    if (l.kind !== 'role') continue;
    if (l.share >= 0.25 && l.requests >= 3 && all.length > 1) {
      advice.push({ roleId: l.id, roleIds: [l.id], kind: 'expensive', message: `Takes ${Math.round(l.share * 100)}% of the spend. Try it on a cheaper model and keep it there if the work holds up.` });
    }
    if (l.toolErrors >= 3 && l.toolErrors / Math.max(1, l.toolCalls) >= 0.3) {
      advice.push({ roleId: l.id, roleIds: [l.id], kind: 'failing', message: `${l.toolErrors} of its ${l.toolCalls} tool calls failed. Check its rules, tools and the commands it runs.` });
    }
  }
  return { lines: own ? [...all, own] : all, rooms, idle, advice, total: { cost: totalCost, tokens: totalTokensUsed } };
}
