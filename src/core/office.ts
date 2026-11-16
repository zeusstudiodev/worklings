// The office's live state: who is in the building, what each person is doing and what they have cost.
// `apply` mutates the state in place (the server owns one copy and sends snapshots to browsers).
import { type OfficeEvent, toolLabel, toolPhrase } from './events.ts';
import { costOf } from './pricing.ts';
import { type Studio, titleFromId } from './studio.ts';
import { addUsage, type TokenUsage, totalTokens, ZERO_USAGE } from './usage.ts';

export type AgentKind = 'lead' | 'role' | 'contractor';
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'done';

/** Someone on the job right now: working, between steps, waiting for you, or stuck on an error. */
const ACTIVE: ReadonlySet<string> = new Set<AgentStatus>(['thinking', 'working', 'waiting', 'error']);
export const isActive = (status: string): boolean => ACTIVE.has(status);

/** How long a subagent that reported back keeps its "Reported back" bubble, and a contractor stays in the lobby. */
export const DONE_SHOWN_MS = 8000;
/** A brief or report meeting in the scene, walks included; the office keeps snapshots coming while one can run. */
export const MEETING_MS = 6500;
export const CONTRACTOR_LINGER_MS = 20_000;

export interface CurrentTool {
  name: string;
  label: string;
  target: string;
  /** The call as a sentence for bubbles: "Edits src/App.tsx". */
  phrase: string;
  toolUseId: string;
  since: number;
}

export interface AgentState {
  key: string;
  sessionId: string;
  agentId: string | null;
  agentType: string;
  kind: AgentKind;
  /** The studio role this agent fills, or null for the lead and for contractors. */
  roleId: string | null;
  name: string;
  /**
   * v0.4 (SPEC-v0.4.md, H2): a subagent a company's desk started with the Agent tool (a Builder's helper): the person
   * whose desk it is. It is drawn beside that person's desk and costs in their line. Absent for everyone else.
   */
  helperOf?: string;
  /** What the lead asked this subagent to do: the Agent call that spawned it, or the SendMessage that continued it. */
  task: string | null;
  /** The request of the person this work serves: their last message to the session when the work began. */
  purpose: string | null;
  /** When it was last briefed: its start after an Agent call, or a SendMessage that continued it. */
  briefedAt: number | null;
  status: AgentStatus;
  /**
   * When the status last changed. Thinking and working alternate on every tool call, so a switch between those two
   * doesn't count: the time says since when someone has been at work, waiting, stuck, done or idle.
   */
  statusSince: number;
  /** When the current piece of work began: waits and passing errors along the way don't restart this clock. */
  busySince: number;
  tool: CurrentTool | null;
  /** Skill (or gate) the agent is working through, from the Skill tool or transcript attribution. */
  skill: string | null;
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  toolCalls: number;
  toolErrors: number;
  files: string[];
  usage: TokenUsage;
  requests: number;
  models: Record<string, number>;
  /** API-equivalent dollars from the price table. */
  costEstimate: number;
  /** Dollars reported by OpenTelemetry, when it is on; used once it covers every request (see agentCost). */
  costReported: number | null;
  /** API requests OpenTelemetry reported a cost for. */
  reportedRequests: number;
  /** Tokens from models the price table doesn't know, so the estimate is a floor. */
  unpricedTokens: number;
  lastMessage: string | null;
  /** When `lastMessage` arrived: a subagent's report back, or the lead's last word of a turn. */
  reportedAt: number | null;
  /** Tokens in the latest request's prompt (input and cache): how much context a side question would have to read. */
  contextTokens: number;
  /**
   * A question waiting on someone: one an AskUserQuestion call puts to the person (until it is answered), or the one a
   * report or the lead's last word ends with (the lead's until the person's next message, a subagent's until its
   * lead's turn ends).
   */
  question: { text: string; at: number; source: 'ask' | 'message' } | null;
  /** While waiting for the person's OK: what it asks to do ("run npm install"). */
  waitingFor: string | null;
  /** The last thing it wasn't allowed to do, and when: a fact worth showing, since it may have found another way. */
  refused: { what: string; at: number } | null;
  error: string | null;
  /** Whether the error came from one tool call, which an agent often works around, or stopped its turn. */
  errorFrom: 'tool' | 'turn' | null;
}

export interface SessionState {
  id: string;
  cwd: string | null;
  transcriptPath: string | null;
  startedAt: number;
  lastEventAt: number;
  ended: boolean;
  lastPrompt: string | null;
  turns: number;
  compacting: boolean;
}

export interface GateRun {
  gateId: string;
  sessionId: string;
  agentKey: string;
  since: number;
  until: number | null;
}

export interface TaskState {
  id: string;
  sessionId: string;
  title: string;
  status: 'open' | 'done';
  owner: string | null;
  createdAt: number;
  doneAt: number | null;
}

export type ActivityTone = 'you' | 'info' | 'start' | 'done' | 'error' | 'waiting';

/**
 * What a milestone was, as it stood then, for the story to put in words (story.ts): what the person asked, who was
 * briefed, what got reported or done, what needed the person, what was refused or stopped.
 */
export type Milestone =
  /** The person's message: a request, or a short reply ("yes", "go on") that leaves the request as it was. */
  | { type: 'asked'; text: string; request: boolean }
  /** Work handed to a subagent by `by` (an agent key): an Agent call and its subagent's start, or a SendMessage. */
  | { type: 'briefed'; task: string | null; by: string }
  /** A subagent reported back, with the question its report ends with. */
  | { type: 'reported'; message: string | null; question: string | null }
  /** A turn ended (the lead's, as a rule) with its last word. */
  | { type: 'finished'; message: string | null; question: string | null }
  /** A permission prompt opened: what it asks to do ("run npm install"). */
  | { type: 'needs-ok'; what: string }
  /** AskUserQuestion put a question to the person. */
  | { type: 'question'; question: string | null }
  /** Claude Code said it waits for the person (an elicitation, or input an agent needs). */
  | { type: 'needs-you'; message: string }
  | { type: 'refused'; what: string }
  /** The turn stopped on an error. */
  | { type: 'stopped'; error: string }
  | { type: 'gate'; gateId: string }
  /** An agent-team task added, or finished. */
  | { type: 'task'; title: string; done: boolean };

interface Entry {
  id: number;
  at: number;
  agentKey: string;
  who: string;
  /** The line as the catch-up account reads it, steps included: "Reads notes.txt", "Reports back". */
  text: string;
  tone: ActivityTone;
}

export type MilestoneEntry = Entry & { kind: 'milestone'; milestone: Milestone };

/**
 * One line of the log. A step is one tool call, or something on the way that the agent may work around (a failed
 * command, a background task finishing): the catch-up account reads steps, the story leaves them out. A milestone is
 * what the story tells.
 */
export type ActivityEntry = (Entry & { kind: 'step' }) | MilestoneEntry;

export const milestones = (activity: readonly ActivityEntry[]): MilestoneEntry[] => activity.filter((e): e is MilestoneEntry => e.kind === 'milestone');

/** A brief the office saw before its subagent: an Agent call names the type it spawns, a SendMessage the agent it continues. */
export type PendingBrief = { by: string; description: string } & ({ agentType: string } | { agentId: string });

export interface BurnSample {
  at: number;
  cost: number;
}

/** One person's totals from sessions the office no longer keeps in full: enough for the payroll. */
export interface ArchivedPerson {
  /** Payroll line: "lead", a role id, or a contractor's agent type. */
  id: string;
  kind: AgentKind;
  name: string;
  usage: TokenUsage;
  requests: number;
  cost: number;
  /** True when every request's cost came from OpenTelemetry. */
  costExact: boolean;
  unpricedTokens: number;
  toolCalls: number;
  toolErrors: number;
  filesChanged: number;
  shifts: number;
}

export interface Archive {
  sessions: number;
  people: Record<string, ArchivedPerson>;
}

export interface OfficeState {
  /** Keyed by ids from hooks and transcripts, so these records have no prototype (see `dict`). */
  sessions: Record<string, SessionState>;
  agents: Record<string, AgentState>;
  /** Keyed by session and task id: task ids repeat across sessions. */
  tasks: Record<string, TaskState>;
  gateRuns: GateRun[];
  activity: ActivityEntry[];
  burn: BurnSample[];
  /** Briefs waiting for their subagent, per session: an Agent call for its SubagentStart, a SendMessage for its agent. */
  pendingBriefs: Record<string, PendingBrief[]>;
  /**
   * v3: the sessions a company's desks run, by session id, with the person (a role id) each one is. Their main agent is
   * drawn as that person instead of as a visitor's lead.
   */
  assigned: Record<string, string>;
  seq: number;
  archive: Archive;
}

/** What the reducer needs to know about the studio: which subagent types are on staff and which skills are gates. */
export interface StudioIndex {
  /** Keyed by the subagent name Claude Code reports (the role id, or its `agent` name when that differs). */
  roles: Map<string, { id: string; title: string; department: string }>;
  gates: Set<string>;
}

export const EMPTY_INDEX: StudioIndex = { roles: new Map(), gates: new Set() };

export function indexStudio(studio: Studio | null): StudioIndex {
  if (!studio) return EMPTY_INDEX;
  return {
    roles: new Map(studio.roles.map((r) => [r.agent ?? r.id, { id: r.id, title: r.title, department: r.department }])),
    gates: new Set(studio.gates.map((g) => g.id)),
  };
}

/** The log keeps this many steps and this many milestones, so a busy hour of tool calls never pushes the story out. */
const MAX_STEPS = 300;
const MAX_MILESTONES = 200;
/** Briefs kept per session for a subagent that may never come (a SendMessage to a teammate by name, a denied spawn). */
const MAX_PENDING = 50;
const MAX_GATE_RUNS = 50;
const MAX_FILES = 50;
const BURN_WINDOW_MS = 30 * 60_000;

/** A record with no prototype: ids come from outside, and "__proto__" or "constructor" must be plain keys. */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export function emptyOffice(): OfficeState {
  return {
    sessions: dict(), agents: dict(), tasks: dict(), gateRuns: [], activity: [], burn: [], pendingBriefs: dict(), assigned: dict(), seq: 0,
    archive: { sessions: 0, people: dict() },
  };
}

/** The payroll line a person counts toward: the lead, their role, or (for contractors) their agent type. */
export const payrollId = (a: Pick<AgentState, 'kind' | 'roleId' | 'agentType'>): string => (a.kind === 'lead' ? 'lead' : (a.roleId ?? a.agentType));

export const leadKey = (sessionId: string) => `${sessionId}:lead`;
export const agentKey = (sessionId: string, agentId: string) => `${sessionId}:${agentId}`;

function newAgent(key: string, sessionId: string, agentId: string | null, agentType: string, at: number, index: StudioIndex): AgentState {
  const agent: AgentState = {
    key, sessionId, agentId, agentType, kind: 'lead', roleId: null, name: 'Lead', task: null, briefedAt: null, status: 'idle', statusSince: at, busySince: at,
    tool: null, skill: null, startedAt: at, lastEventAt: at, endedAt: null, toolCalls: 0, toolErrors: 0, files: [],
    usage: ZERO_USAGE, requests: 0, models: dict(), costEstimate: 0, costReported: null, reportedRequests: 0, unpricedTokens: 0,
    lastMessage: null, reportedAt: null, contextTokens: 0, purpose: null, question: null, waitingFor: null, refused: null, error: null, errorFrom: null,
  };
  if (agentId) classifyAgent(agent, index);
  return agent;
}

function classifyAgent(agent: AgentState, index: StudioIndex) {
  const role = index.roles.get(agent.agentType);
  agent.kind = role ? 'role' : 'contractor';
  agent.roleId = role ? role.id : null;
  agent.name = role ? role.title : titleFromId(agent.agentType.replace(/^.*:/, ''));
}

/**
 * A desk's main agent as its person: their role's title and room while the studio has the role, and a contractor (in
 * the lobby, not at anyone's desk) once they were fired. `agentType` names the person, as a subagent's names its type.
 */
function classifyDesk(agent: AgentState, person: string, index: StudioIndex) {
  let role: { id: string; title: string } | undefined;
  for (const r of index.roles.values()) if (r.id === person) role = r;
  agent.agentType = person;
  agent.kind = role ? 'role' : 'contractor';
  agent.roleId = role ? role.id : null;
  agent.name = role ? role.title : titleFromId(person);
}

/**
 * v0.4: a subagent of a company's desk is that person's helper, whatever type it is: it stands beside their desk, counts in
 * their payroll line and is called "<their title>'s helper". Once fired, the person's helpers wait in the lobby like them.
 */
function classifyHelper(agent: AgentState, person: string, index: StudioIndex) {
  let role: { id: string; title: string } | undefined;
  for (const r of index.roles.values()) if (r.id === person) role = r;
  agent.kind = role ? 'role' : 'contractor';
  agent.roleId = role ? role.id : null;
  agent.helperOf = person;
  agent.name = `${role ? role.title : titleFromId(person)}'s helper`;
}

/** Re-sorts every subagent, and every desk's main agent, after the studio changes (a hire or a fire). */
export function relabel(state: OfficeState, index: StudioIndex) {
  for (const agent of Object.values(state.agents)) {
    if (agent.agentId && Object.hasOwn(state.assigned, agent.sessionId)) classifyHelper(agent, state.assigned[agent.sessionId] ?? '', index);
    else if (agent.agentId) classifyAgent(agent, index);
    else if (Object.hasOwn(state.assigned, agent.sessionId)) classifyDesk(agent, state.assigned[agent.sessionId] ?? '', index);
  }
}

/**
 * v3: the session is a company's desk for `person` (a role id), so its main agent is drawn as that person. Other
 * sessions in the folder stay visitors. Returns false when the session already was that person's.
 */
export function assignSession(state: OfficeState, sessionId: string, person: string, index: StudioIndex = EMPTY_INDEX): boolean {
  if (state.assigned[sessionId] === person) return false;
  state.assigned[sessionId] = person;
  const main = state.agents[leadKey(sessionId)];
  if (main) classifyDesk(main, person, index);
  for (const a of Object.values(state.agents)) if (a.sessionId === sessionId && a.agentId) classifyHelper(a, person, index);
  return true;
}

function session(state: OfficeState, e: OfficeEvent): SessionState {
  let s = state.sessions[e.sessionId];
  if (!s) {
    s = {
      id: e.sessionId, cwd: e.cwd ?? null, transcriptPath: e.transcriptPath ?? null, startedAt: e.at, lastEventAt: e.at,
      ended: false, lastPrompt: null, turns: 0, compacting: false,
    };
    state.sessions[e.sessionId] = s;
  }
  if (e.cwd && !s.cwd) s.cwd = e.cwd;
  if (e.transcriptPath && !s.transcriptPath) s.transcriptPath = e.transcriptPath;
  s.lastEventAt = Math.max(s.lastEventAt, e.at);
  if (e.kind !== 'session-end' && e.kind !== 'usage' && e.kind !== 'cost') s.ended = false;
  return s;
}

function lead(state: OfficeState, sessionId: string, at: number, index: StudioIndex): AgentState {
  const key = leadKey(sessionId);
  let a = state.agents[key];
  if (!a) {
    a = newAgent(key, sessionId, null, 'lead', at, index);
    if (Object.hasOwn(state.assigned, sessionId)) classifyDesk(a, state.assigned[sessionId] ?? '', index);
    state.agents[key] = a;
  }
  return a;
}

function subagent(state: OfficeState, sessionId: string, agentId: string, agentType: string | undefined, at: number, index: StudioIndex): AgentState {
  const key = agentKey(sessionId, agentId);
  let a = state.agents[key];
  if (!a) {
    a = newAgent(key, sessionId, agentId, agentType ?? 'agent', at, index);
    if (Object.hasOwn(state.assigned, sessionId)) classifyHelper(a, state.assigned[sessionId] ?? '', index);
    state.agents[key] = a;
    // A SendMessage the office saw before this subagent briefed it; it counts from the moment the office sees it.
    const sent = takeBrief(state, sessionId, agentId, null);
    if (sent) brief(state, a, sent.description || null, sent.by, at);
  } else if (agentType && a.agentType === 'agent') {
    a.agentType = agentType;
    if (Object.hasOwn(state.assigned, sessionId)) classifyHelper(a, state.assigned[sessionId] ?? '', index);
    else classifyAgent(a, index);
  }
  return a;
}

/** The agent an event is about: the subagent when the event names one, otherwise the session's lead. */
function actor(state: OfficeState, e: OfficeEvent, index: StudioIndex): AgentState {
  const a = e.agentId ? subagent(state, e.sessionId, e.agentId, e.agentType, e.at, index) : lead(state, e.sessionId, e.at, index);
  a.lastEventAt = Math.max(a.lastEventAt, e.at);
  return a;
}

/** Logs a step, or with `milestone` a milestone the story tells; each kind drops its own oldest lines past its cap. */
function log(state: OfficeState, at: number, agent: AgentState, text: string, tone: ActivityTone, milestone: Milestone | null = null, who = agent.name) {
  state.seq += 1;
  const entry = { id: state.seq, at, agentKey: agent.key, who, text, tone };
  state.activity.push(milestone ? { ...entry, kind: 'milestone', milestone } : { ...entry, kind: 'step' });
  const kind = milestone ? 'milestone' : 'step';
  let count = 0;
  for (const e of state.activity) if (e.kind === kind) count += 1;
  if (count > (milestone ? MAX_MILESTONES : MAX_STEPS)) state.activity.splice(state.activity.findIndex((e) => e.kind === kind), 1);
}

function queueBrief(state: OfficeState, sessionId: string, pending: PendingBrief) {
  const queue = (state.pendingBriefs[sessionId] ??= []);
  queue.push(pending);
  if (queue.length > MAX_PENDING) queue.shift();
}

/** The brief waiting for this subagent: a SendMessage to its id, else (with `agentType`) the oldest Agent call for its type. */
function takeBrief(state: OfficeState, sessionId: string, agentId: string, agentType: string | null): PendingBrief | null {
  const queue = state.pendingBriefs[sessionId];
  if (!queue) return null;
  let i = queue.findIndex((p) => 'agentId' in p && p.agentId === agentId);
  if (i < 0 && agentType !== null) i = queue.findIndex((p) => 'agentType' in p && p.agentType === agentType);
  return i < 0 ? null : (queue.splice(i, 1)[0] ?? null);
}

/**
 * Hands a subagent a piece of work, from `by`: its Agent call met its start, or a SendMessage continued it. The story
 * tells the brief and the start as one line ("The lead briefed the QA engineer: …").
 */
function brief(state: OfficeState, a: AgentState, task: string | null, by: string, at: number) {
  if (task) a.task = task;
  a.purpose = state.agents[leadKey(a.sessionId)]?.purpose ?? state.sessions[a.sessionId]?.lastPrompt ?? null;
  a.briefedAt = at;
  log(state, at, a, task ? `Starts on: ${task}` : 'Starts work', 'start', { type: 'briefed', task, by });
}

function closeGates(state: OfficeState, agent: AgentState, at: number) {
  for (const run of state.gateRuns) if (run.agentKey === agent.key && run.until === null) run.until = at;
}

const phase = (status: AgentStatus) => (status === 'working' || status === 'thinking' ? 'at work' : status);

/** Every status change goes through here, so `statusSince` stays true (see AgentState). */
function setStatus(agent: AgentState, status: AgentStatus, at: number) {
  if (phase(agent.status) !== phase(status)) agent.statusSince = at;
  if (!isActive(agent.status) && isActive(status)) agent.busySince = at;
  if (status !== 'waiting') agent.waitingFor = null;
  if (status !== 'error') agent.errorFrom = null;
  agent.status = status;
}

/** A report or the lead's last word; the question it ends with replaces any earlier one. */
function report(agent: AgentState, message: string | undefined, question: string | undefined, at: number) {
  if (!message) return;
  agent.lastMessage = message;
  agent.reportedAt = at;
  if (question) agent.question = { text: question, at, source: 'message' };
  else if (agent.question?.source === 'message') agent.question = null;
}

/** "yes" or "go on" answers the lead; it isn't a new request. */
const isRequest = (text: string) => text.trim().split(/\s+/).length >= 4;

export function apply(state: OfficeState, e: OfficeEvent, index: StudioIndex = EMPTY_INDEX): void {
  const s = session(state, e);

  switch (e.kind) {
    case 'prompt': {
      const a = actor(state, e, index);
      const request = isRequest(e.text) || (!a.agentId && a.purpose === null);
      if (!e.notification) {
        s.lastPrompt = e.text;
        s.turns += 1;
        if (!a.agentId) {
          if (request) a.purpose = e.text;
          // The person has spoken: an open question is answered, and an earlier refusal belongs to earlier work.
          a.question = null;
          a.refused = null;
        }
      }
      setStatus(a, 'thinking', e.at);
      a.error = null;
      // A background task finishing is a step on the way; what the person writes is a milestone.
      if (e.notification) log(state, e.at, a, e.text, 'info');
      else log(state, e.at, a, e.text, 'you', { type: 'asked', text: e.text, request }, 'You');
      break;
    }
    case 'tool-start': {
      const a = actor(state, e, index);
      setStatus(a, 'working', e.at);
      a.error = null;
      a.toolCalls += 1;
      a.tool = { name: e.tool, label: toolLabel(e.tool), target: e.target, phrase: toolPhrase(e.tool, e.target), toolUseId: e.toolUseId, since: e.at };
      const gate = e.tool === 'Skill' && e.target && index.gates.has(e.target) ? e.target : null;
      if (e.tool === 'Skill' && e.target) a.skill = e.target;
      if (gate) {
        state.gateRuns.push({ gateId: gate, sessionId: e.sessionId, agentKey: a.key, since: e.at, until: null });
        if (state.gateRuns.length > MAX_GATE_RUNS) state.gateRuns.splice(0, state.gateRuns.length - MAX_GATE_RUNS);
      }
      if (e.spawn) queueBrief(state, e.sessionId, { by: a.key, description: e.spawn.description, agentType: e.spawn.agentType });
      if (e.ask) a.question = { text: e.ask, at: e.at, source: 'ask' };
      // A tool call is a step, except a gate and a question to the person. A spawn's brief is told at its start.
      const phrase = toolPhrase(e.tool, e.target);
      if (gate) log(state, e.at, a, phrase, 'start', { type: 'gate', gateId: gate });
      else if (e.tool === 'AskUserQuestion') log(state, e.at, a, phrase, 'waiting', { type: 'question', question: e.ask ?? null });
      else log(state, e.at, a, phrase, 'start');
      if (e.brief) {
        const target = state.agents[agentKey(e.sessionId, e.brief.agentId)];
        // Only a subagent is continued this way ("lead" as an id would name the session's own lead, see agentKey).
        if (target?.agentId) brief(state, target, e.brief.description || null, a.key, e.at);
        else if (!target) queueBrief(state, e.sessionId, { by: a.key, description: e.brief.description, agentId: e.brief.agentId });
      }
      break;
    }
    case 'tool-end': {
      const a = actor(state, e, index);
      const call = a.tool?.toolUseId === e.toolUseId ? a.tool : null;
      if (call || !a.tool) a.tool = null;
      if (e.tool === 'AskUserQuestion' && a.question?.source === 'ask') a.question = null;
      if (e.file && !a.files.includes(e.file)) {
        a.files.push(e.file);
        if (a.files.length > MAX_FILES) a.files.shift();
      }
      if (e.ok) {
        if (a.status !== 'done') setStatus(a, a.tool ? 'working' : 'thinking', e.at);
      } else {
        a.toolErrors += 1;
        setStatus(a, 'error', e.at);
        a.error = e.error ?? 'Failed';
        a.errorFrom = 'tool';
        log(state, e.at, a, call ? `Couldn't ${toolPhrase(e.tool, call.target, 'infinitive')}: ${a.error}` : `${toolLabel(e.tool)} failed: ${a.error}`, 'error');
      }
      break;
    }
    case 'subagent-start': {
      const a = subagent(state, e.sessionId, e.agentId, e.agentType, e.at, index);
      // Briefed since it last stopped (a SendMessage, told when it came): this start is that brief's.
      const told = a.briefedAt !== null && a.briefedAt >= (a.endedAt ?? a.startedAt);
      setStatus(a, 'thinking', e.at);
      a.endedAt = null;
      if (!told) {
        // A first start takes the oldest Agent call for its type; a later one only a brief sent to it by id.
        const pending = takeBrief(state, e.sessionId, e.agentId, a.briefedAt === null ? e.agentType : null);
        brief(state, a, pending ? pending.description || null : null, pending?.by ?? leadKey(e.sessionId), e.at);
      }
      break;
    }
    case 'subagent-stop': {
      const a = subagent(state, e.sessionId, e.agentId, e.agentType, e.at, index);
      setStatus(a, 'done', e.at);
      a.tool = null;
      a.endedAt = e.at;
      report(a, e.lastMessage, e.question, e.at);
      closeGates(state, a, e.at);
      log(state, e.at, a, 'Reports back', 'done', { type: 'reported', message: e.lastMessage ?? null, question: e.question ?? null });
      break;
    }
    case 'permission': {
      const a = actor(state, e, index);
      const what = toolPhrase(e.tool, e.target, 'infinitive');
      setStatus(a, 'waiting', e.at);
      a.waitingFor = what;
      log(state, e.at, a, `Asks to ${what}`, 'waiting', { type: 'needs-ok', what });
      break;
    }
    case 'permission-denied': {
      const a = actor(state, e, index);
      const what = toolPhrase(e.tool, e.target, 'infinitive');
      setStatus(a, 'thinking', e.at);
      a.tool = null;
      a.refused = { what, at: e.at };
      log(state, e.at, a, `Wasn't allowed to ${what}`, 'error', { type: 'refused', what });
      break;
    }
    case 'notice': {
      const a = actor(state, e, index);
      // The notice a permission prompt sends says nothing its request didn't.
      const echo = a.status === 'waiting' && a.waitingFor !== null;
      if (e.needsYou && a.status !== 'working') setStatus(a, 'waiting', e.at);
      if (e.message) log(state, e.at, a, e.message, e.needsYou ? 'waiting' : 'info', e.needsYou && !echo ? { type: 'needs-you', message: e.message } : null);
      break;
    }
    case 'turn-end': {
      const a = actor(state, e, index);
      a.tool = null;
      report(a, e.lastMessage, e.question, e.at);
      closeGates(state, a, e.at);
      // The lead has had the reports by the end of its turn, questions included.
      if (!a.agentId) {
        for (const other of Object.values(state.agents)) {
          if (other.sessionId === e.sessionId && other.agentId && other.question?.source === 'message' && other.question.at <= e.at) other.question = null;
        }
      }
      if (e.failed) {
        const error = e.lastMessage ?? 'The turn failed';
        setStatus(a, 'error', e.at);
        a.error = error;
        a.errorFrom = 'turn';
        log(state, e.at, a, `Stopped: ${error}`, 'error', { type: 'stopped', error });
      } else {
        // A second end with nothing to say (a replay closes the session this way) tells nothing new.
        const again = a.status === 'idle' && !e.lastMessage;
        setStatus(a, 'idle', e.at);
        a.skill = null;
        log(state, e.at, a, 'Done for now', 'done', again ? null : { type: 'finished', message: e.lastMessage ?? null, question: e.question ?? null });
      }
      break;
    }
    case 'session-end': {
      s.ended = true;
      for (const a of Object.values(state.agents)) {
        if (a.sessionId !== e.sessionId) continue;
        a.tool = null;
        if (a.status !== 'done') setStatus(a, a.agentId ? 'done' : 'idle', e.at);
        if (a.agentId && a.endedAt === null) a.endedAt = e.at;
        closeGates(state, a, e.at);
      }
      break;
    }
    case 'compact': {
      s.compacting = e.phase === 'start';
      const a = actor(state, e, index);
      if (e.phase === 'start') log(state, e.at, a, 'Tidies up the conversation to free context', 'info');
      break;
    }
    case 'teammate-idle': {
      const mate = Object.values(state.agents).find((a) => a.sessionId === e.sessionId && (a.agentType === e.teammate || a.name === e.teammate));
      if (mate && mate.status !== 'done') setStatus(mate, 'idle', e.at);
      break;
    }
    case 'task': {
      const key = `${e.sessionId}:${e.taskId}`;
      const known = state.tasks[key];
      const task: TaskState = known ?? { id: e.taskId, sessionId: e.sessionId, title: e.title, status: 'open', owner: null, createdAt: e.at, doneAt: null };
      task.title = e.title || task.title;
      if (e.owner) task.owner = e.owner;
      // The story tells a task once when it is added and once when it is done; the same news again is a step.
      const done = e.status === 'done' && task.status !== 'done';
      if (done) {
        task.status = 'done';
        task.doneAt = e.at;
      }
      state.tasks[key] = task;
      const news = done || (!known && e.status === 'open');
      log(
        state, e.at, actor(state, e, index), e.status === 'done' ? `Completes a task: ${task.title}` : `Adds a task: ${task.title}`, e.status === 'done' ? 'done' : 'info',
        news ? { type: 'task', title: task.title, done } : null,
      );
      break;
    }
    case 'usage': {
      const a = actor(state, e, index);
      a.usage = addUsage(a.usage, e.usage);
      a.contextTokens = e.usage.input + e.usage.cacheRead + e.usage.cacheWrite5m + e.usage.cacheWrite1h;
      a.requests += 1;
      a.models[e.model] = (a.models[e.model] ?? 0) + 1;
      if (e.skill) a.skill = e.skill;
      const tokens = totalTokens(e.usage);
      const cost = costOf(e.model, e.usage, { fast: e.fast === true, usOnly: e.usOnly === true });
      if (cost === null) a.unpricedTokens += tokens;
      else a.costEstimate += cost;
      state.burn.push({ at: e.at, cost: cost ?? 0 });
      const cutoff = e.at - BURN_WINDOW_MS;
      while (state.burn.length > 0 && (state.burn[0]?.at ?? cutoff) < cutoff) state.burn.shift();
      break;
    }
    case 'cost': {
      const a = actor(state, e, index);
      a.costReported = (a.costReported ?? 0) + e.costUsd;
      a.reportedRequests += 1;
      break;
    }
  }
}

/**
 * Marks people who have gone quiet: a subagent with no event for 15 minutes has most likely ended unseen. Returns
 * true when anyone changed, so the office knows to tell the browsers.
 */
export function sweep(state: OfficeState, now: number): boolean {
  let changed = false;
  for (const a of Object.values(state.agents)) {
    if (a.agentId && a.status !== 'done' && now - a.lastEventAt > 15 * 60_000) {
      setStatus(a, 'done', a.lastEventAt);
      a.tool = null;
      a.endedAt = a.lastEventAt;
      changed = true;
    } else if (!a.agentId && a.status !== 'idle' && a.status !== 'waiting' && now - a.lastEventAt > 15 * 60_000) {
      setStatus(a, 'idle', a.lastEventAt);
      a.tool = null;
      changed = true;
    }
  }
  return changed;
}

/** Sessions the office keeps in full. Older ones that ended (or went quiet) fold into the archive. */
export const KEEP_SESSIONS = 12;
const QUIET_FOR_MS = 6 * 60 * 60_000;

/** Folds old sessions into per-person totals so an office left open for days stays small. Returns their ids. */
export function evict(state: OfficeState, now: number, keep = KEEP_SESSIONS): string[] {
  const sessions = Object.values(state.sessions).sort((a, b) => b.lastEventAt - a.lastEventAt);
  const gone = sessions.slice(keep).filter((s) => s.ended || now - s.lastEventAt > QUIET_FOR_MS).map((s) => s.id);
  if (gone.length === 0) return gone;
  const ids = new Set(gone);
  for (const [key, a] of Object.entries(state.agents)) {
    if (!ids.has(a.sessionId)) continue;
    archivePerson(state.archive, a);
    delete state.agents[key];
  }
  for (const [key, t] of Object.entries(state.tasks)) if (ids.has(t.sessionId)) delete state.tasks[key];
  for (const id of gone) {
    delete state.sessions[id];
    delete state.pendingBriefs[id];
    delete state.assigned[id];
  }
  state.gateRuns = state.gateRuns.filter((g) => !ids.has(g.sessionId));
  state.archive.sessions += gone.length;
  return gone;
}

function archivePerson(archive: Archive, a: AgentState) {
  const id = payrollId(a);
  const p = (archive.people[id] ??= {
    id, kind: a.kind, name: a.name, usage: ZERO_USAGE, requests: 0, cost: 0, costExact: true, unpricedTokens: 0, toolCalls: 0,
    toolErrors: 0, filesChanged: 0, shifts: 0,
  });
  p.usage = addUsage(p.usage, a.usage);
  p.requests += a.requests;
  p.cost += agentCost(a);
  if (a.requests > 0 && !usesReported(a)) p.costExact = false;
  p.unpricedTokens += a.unpricedTokens;
  p.toolCalls += a.toolCalls;
  p.toolErrors += a.toolErrors;
  p.filesChanged += a.files.length;
  p.shifts += 1;
}

/**
 * OpenTelemetry's cost is exact, but an office started mid-session hears only about later requests, while the
 * transcript has them all. So the reported cost counts once it covers every request, and the estimate until then.
 */
export const usesReported = (a: AgentState): boolean => a.costReported !== null && a.reportedRequests >= a.requests;

export function agentCost(a: AgentState): number {
  return usesReported(a) ? (a.costReported ?? 0) : a.costEstimate;
}

export interface Totals {
  usage: TokenUsage;
  cost: number;
  /** True when every dollar came from OpenTelemetry. */
  costExact: boolean;
  unpricedTokens: number;
  /** People on the job right now (see isActive). */
  active: number;
}

export function totals(state: OfficeState): Totals {
  let usage = ZERO_USAGE;
  let cost = 0;
  let unpriced = 0;
  let active = 0;
  let exact = true;
  let reported = false;
  for (const a of Object.values(state.agents)) {
    usage = addUsage(usage, a.usage);
    cost += agentCost(a);
    unpriced += a.unpricedTokens;
    if (a.requests > 0 || a.costReported !== null) {
      if (usesReported(a)) reported = true;
      else exact = false;
    }
    if (isActive(a.status)) active += 1;
  }
  for (const p of Object.values(state.archive.people)) {
    usage = addUsage(usage, p.usage);
    cost += p.cost;
    unpriced += p.unpricedTokens;
    if (p.requests > 0) {
      if (p.costExact) reported = true;
      else exact = false;
    }
  }
  return { usage, cost, costExact: exact && reported, unpricedTokens: unpriced, active };
}

/** Dollars per hour over the last `windowMs` before `now`. */
export function burnRate(state: OfficeState, now: number, windowMs = 5 * 60_000): { dollarsPerHour: number } {
  let cost = 0;
  for (const sample of state.burn) if (sample.at >= now - windowMs && sample.at <= now) cost += sample.cost;
  return { dollarsPerHour: (cost / (windowMs / 60_000)) * 60 };
}
