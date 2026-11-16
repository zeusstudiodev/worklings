// The account Catch me up hands to Claude Code: what the studio did between two moments, as compact plain text that
// a cheap model turns into a few sentences. Built only from what the office already knows, so writing it costs nothing.
// What each person is doing comes from personState, so the digest and the Now board never disagree.
import { NEEDS_YOU, needsYou, type PersonState, personState } from './now.ts';
import { type ActivityEntry, type AgentState, agentCost, type GateRun, isActive, type SessionState, usesReported } from './office.ts';
import { redactClip, redactSecrets } from './redact.ts';
import { type Studio, titleFromId } from './studio.ts';
import { capital, nameInSentence, nameOnTeam } from './words.ts';

export interface AccountInput {
  studioName: string;
  agents: AgentState[];
  sessions: SessionState[];
  activity: ActivityEntry[];
  gateRuns: GateRun[];
  studio: Studio | null;
}

export interface Account {
  text: string;
  /** No activity, report or status change falls in the period, so there is nothing to summarise. */
  nothingNew: boolean;
  since: number;
  until: number;
}

/** However busy the studio was, an account stays cheap to read: the newest activity lines win. */
export const ACCOUNT_MAX_LINES = 120;
export const ACCOUNT_MAX_CHARS = 24_000;
/** Room for the people; activity gets what the other sections leave. */
const PEOPLE_MAX_CHARS = 12_000;
/** Lines in each short list (who needs you, gates) before the rest is counted instead. */
const LIST_MAX = 20;
const FILES_SHOWN = 10;

interface Context {
  since: number;
  until: number;
  sessions: Map<string, SessionState>;
  /** Each person's state at `until`, as the Now board reads it. */
  states: Map<string, PersonState>;
  /** Leads in the account: with more than one, each is told apart by when its session started. */
  leads: number;
}

const inPeriod = (t: number | null, ctx: Context): boolean => t !== null && t > ctx.since && t <= ctx.until;
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Text from outside on one line, masked and cut. */
const clean = (text: string, max: number) => redactClip(flat(text), max);
const stateOf = (a: AgentState, ctx: Context): PersonState => ctx.states.get(a.key) ?? personState(a, ctx.until);
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** "12 min before now": an account counts back from its end (now, or the replay position), never in clock time. */
function beforeNow(at: number, until: number): string {
  const minutes = Math.floor(Math.max(0, until - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min before now`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h before now` : `${hours} h ${minutes % 60} min before now`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day before now' : `${days} days before now`;
}

function money(dollars: number): string {
  if (dollars === 0) return '$0';
  if (dollars < 0.01) return 'under $0.01';
  if (dollars < 100) return `$${dollars.toFixed(2)}`;
  return `$${String(Math.round(dollars)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const nameOf = (a: AgentState) => clean(a.name, 60) || 'Someone';

/** How a person reads inside a sentence, as the headline names them: "the lead", "the QA engineer", "the Explore agent". */
const mention = (a: AgentState, ctx: Context): string => clean(nameInSentence(a, ctx.leads > 1), 80);

/** How a person heads their own block: "Lead" ("Lead, session 3f2a1c"), "QA engineer", "Explore (contractor)". */
function label(a: AgentState, ctx: Context): string {
  if (a.kind === 'lead') return nameOnTeam(a, ctx.leads > 1);
  return a.kind === 'contractor' ? `${nameOf(a)} (contractor)` : nameOf(a);
}

/** "20 min", "1 h 5 min": how long something has been going. */
function lasting(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** A sentence that ends with its own punctuation, or with a full stop. */
const ended = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** "has a question for you" is only the lead's: a subagent's report is addressed to its lead first. */
const hasQuestion = (a: AgentState) => (a.agentId ? 'has a question' : 'has a question for you');

/** What someone is doing now, in the Now board's words (docs/design.md, "What a person is doing, in plain words"). */
function nowOf(a: AgentState, ctx: Context): string {
  const state = stateOf(a, ctx);
  const since = beforeNow(state.since, ctx.until);
  switch (state.kind) {
    case 'needs-ok':
      return `needs your OK to ${clean(state.what, 200)}, waiting since ${since}`;
    case 'needs-answer':
      return `needs your answer, waiting since ${since}${state.question ? `: ${clean(state.question, 300)}` : ''}`;
    case 'stuck':
      return `stuck since ${since}: ${clean(state.error, 200)}`;
    case 'has-question':
      return `${hasQuestion(a)}, asked ${since}: ${clean(state.question, 300)}`;
    case 'on-it': {
      const step = a.tool ? `, current step: ${clean(a.tool.phrase, 160)}${state.step ? ` (running for ${lasting(ctx.until - state.step.since)})` : ''}` : '';
      return `on it since ${since}${step}`;
    }
    case 'done':
      return `done ${since}`;
    case 'idle':
      return `idle since ${since}`;
  }
}

/** The line a person gets under Needs you, or null when their state doesn't need the person. */
function needLine(a: AgentState, ctx: Context): string | null {
  const state = stateOf(a, ctx);
  const who = capital(mention(a, ctx));
  const since = beforeNow(state.since, ctx.until);
  switch (state.kind) {
    case 'needs-ok':
      return `- ${who} needs your OK to ${clean(state.what, 200)} (waiting since ${since}).`;
    case 'needs-answer':
      return `- ${who} needs your answer (waiting since ${since})${state.question ? `: ${ended(clean(state.question, 300))}` : '.'}`;
    case 'stuck':
      return `- ${who} is stuck (since ${since}): ${ended(clean(state.error, 200))}`;
    case 'has-question':
      return `- ${who} ${hasQuestion(a)} (asked ${since}): ${ended(clean(state.question, 300))}`;
    default:
      return null;
  }
}

function costOf(a: AgentState): string {
  return `${a.unpricedTokens > 0 ? 'at least ' : ''}${money(agentCost(a))}${usesReported(a) ? ' (reported)' : ''}`;
}

function personBlock(a: AgentState, ctx: Context): string {
  const lines = [label(a, ctx)];
  // The goal: a subagent's brief, or for the lead the person's request; a subagent's purpose is the request it serves.
  if (a.agentId && a.task) lines.push(`- Brief: ${clean(a.task, 300)}`);
  if (a.purpose) lines.push(`- For the request: ${clean(a.purpose, 300)}`);
  const last = a.agentId ? null : (ctx.sessions.get(a.sessionId)?.lastPrompt ?? null);
  // A short reply ("yes, go on") answers the lead without becoming its request.
  if (last && flat(last) !== flat(a.purpose ?? '')) lines.push(`- Your last message: ${clean(last, 300)}`);
  lines.push(`- Now: ${nowOf(a, ctx)}`);
  if (a.lastMessage && inPeriod(a.reportedAt, ctx)) {
    lines.push(`- Reported ${beforeNow(a.reportedAt ?? ctx.until, ctx.until)}: ${clean(a.lastMessage, 400)}`);
  }
  // A fact, not a state: it may have found another way.
  if (a.refused && inPeriod(a.refused.at, ctx)) lines.push(`- Wasn't allowed to ${clean(a.refused.what, 200)} (${beforeNow(a.refused.at, ctx.until)})`);
  if (a.files.length > 0) {
    const shown = a.files.slice(-FILES_SHOWN).map((f) => clean(f, 120));
    const more = a.files.length - shown.length;
    lines.push(`- Files changed so far (${a.files.length}): ${shown.join(', ')}${more > 0 ? `, and ${more} earlier ones` : ''}`);
  }
  if (a.toolErrors > 0) lines.push(`- Tool calls that failed so far: ${a.toolErrors}`);
  lines.push(`- Cost so far: ${costOf(a)}`);
  return lines.join('\n');
}

/** Lines past `max` are counted, not shown. */
function capped(lines: string[], max: number, what: string): string[] {
  return lines.length <= max ? lines : [...lines.slice(0, max), `- And ${lines.length - max} more ${what}.`];
}

/** Everyone whose state needs the person, in the order the Now board's Needs you group names them. */
function needsYouSection(people: AgentState[], ctx: Context): string {
  const rank = (a: AgentState) => NEEDS_YOU.indexOf(stateOf(a, ctx).kind);
  const lines = people
    .filter((a) => needsYou(stateOf(a, ctx)))
    .sort((a, b) => rank(a) - rank(b) || stateOf(a, ctx).since - stateOf(b, ctx).since || order(a.key, b.key))
    .map((a) => needLine(a, ctx) ?? '');
  if (lines.length === 0) return 'Needs you: nobody needs your OK or an answer, has a question, or is stuck.';
  return ['Needs you:', ...capped(lines, LIST_MAX, 'people who need you')].join('\n');
}

/** Who matters most when not everyone fits: people who need you, then people at work, then fresh reports. */
function importance(a: AgentState, ctx: Context): number {
  const state = stateOf(a, ctx);
  if (needsYou(state)) return 0;
  if (state.kind === 'on-it') return 1;
  return inPeriod(a.reportedAt, ctx) ? 2 : 3;
}

function peopleSection(people: AgentState[], ctx: Context): string {
  if (people.length === 0) return 'People: nobody worked in this period.';
  const blocks = new Map(people.map((a) => [a.key, personBlock(a, ctx)]));
  const size = (a: AgentState) => (blocks.get(a.key)?.length ?? 0) + 1;
  let shown = people;
  if (people.reduce((sum, a) => sum + size(a), 0) > PEOPLE_MAX_CHARS) {
    const ranked = [...people].sort((a, b) => importance(a, ctx) - importance(b, ctx) || b.lastEventAt - a.lastEventAt || order(a.key, b.key));
    const keep = new Set<string>();
    let used = 0;
    for (const a of ranked) {
      if (used + size(a) > PEOPLE_MAX_CHARS) break;
      keep.add(a.key);
      used += size(a);
    }
    shown = people.filter((a) => keep.has(a.key));
  }
  const lines = [`People who worked (${people.length}):`, ...shown.map((a) => blocks.get(a.key) ?? '')];
  const rest = people.filter((a) => !shown.includes(a));
  if (rest.length > 0) {
    // Counted by title, so fifty people fit on a line: "Lead, QA engineer (11), Backend engineer (11)".
    const counts = new Map<string, number>();
    for (const a of rest) counts.set(label(a, ctx), (counts.get(label(a, ctx)) ?? 0) + 1);
    const names = redactClip([...counts].map(([name, n]) => (n > 1 ? `${name} (${n})` : name)).join(', '), 1_000);
    lines.push(`${rest.length} more ${rest.length === 1 ? 'person' : 'people'} also worked: ${names}.`);
  }
  return lines.join('\n');
}

function gatesSection(runs: GateRun[], agents: AgentState[], studio: Studio | null, ctx: Context): string {
  const inRange = runs
    .filter((g) => g.since <= ctx.until && (g.until === null || g.until > ctx.since))
    .sort((a, b) => a.since - b.since || order(a.gateId, b.gateId) || order(a.agentKey, b.agentKey));
  if (inRange.length === 0) return 'Gates: none ran in this period.';
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const lines = inRange.map((g) => {
    const title = clean(studio?.gates.find((gate) => gate.id === g.gateId)?.title ?? titleFromId(g.gateId), 80);
    const runner = byKey.get(g.agentKey);
    const who = runner ? mention(runner, ctx) : 'someone';
    return g.until === null || g.until > ctx.until
      ? `- ${title}: ${who} started it ${beforeNow(g.since, ctx.until)} and is still in it.`
      : `- ${title}: ${who} ran it from ${beforeNow(g.since, ctx.until)} to ${beforeNow(g.until, ctx.until)}.`;
  });
  return ['Gates that ran:', ...capped(lines, LIST_MAX, 'gate runs')].join('\n');
}

function costSection(people: AgentState[], agents: AgentState[]): string {
  const sum = (list: AgentState[]) => list.reduce((total, a) => total + agentCost(a), 0);
  const floor = (list: AgentState[]) => (list.some((a) => a.unpricedTokens > 0) ? 'at least ' : '');
  return `Cost so far of the people above: ${floor(people)}${money(sum(people))}. Of everyone the office has seen: ${floor(agents)}${money(sum(agents))}.`;
}

/** The period's activity, oldest first, keeping the newest lines that fit in `room` characters. */
function activitySection(activity: ActivityEntry[], ctx: Context, room: number): string {
  if (activity.length === 0) return 'Activity: none in this period.';
  const lines = activity.map((e) => `[${beforeNow(e.at, ctx.until)}] ${clean(e.who, 60)}: ${clean(e.text, 240)}`);
  const titleRoom = 90;
  const kept: string[] = [];
  let used = titleRoom;
  for (let i = lines.length - 1; i >= 0 && kept.length < ACCOUNT_MAX_LINES; i--) {
    const line = lines[i] ?? '';
    if (used + line.length + 1 > room) break;
    kept.push(line);
    used += line.length + 1;
  }
  kept.reverse();
  const left = lines.length - kept.length;
  if (kept.length === 0) return `Activity: ${lines.length} lines in this period, left out for space.`;
  return [`Activity, oldest first (${kept.length} lines${left > 0 ? `; the ${left} earlier ones are left out` : ''}):`, ...kept].join('\n');
}

/**
 * What happened after `since` and up to `until`, for Claude Code to summarise: from the person's last catch-up (or an
 * hour ago) to now, or to the replay position. Deterministic for the same input whatever the order of its lists, at
 * most ACCOUNT_MAX_CHARS long, and secrets come out as "[redacted]".
 */
export function catchUpAccount(input: AccountInput, since: number, until: number): Account {
  const states = new Map(input.agents.map((a) => [a.key, personState(a, until)]));
  const base: Context = { since, until, sessions: new Map(input.sessions.map((s) => [s.id, s])), states, leads: 0 };
  const activity = input.activity.filter((e) => inPeriod(e.at, base)).sort((a, b) => a.at - b.at || a.id - b.id);
  const busy = new Set(activity.map((e) => e.agentKey));
  // Everyone with news in the period, everyone on the job, and everyone the Now board would list under Needs you.
  const news = (a: AgentState) => busy.has(a.key) || inPeriod(a.reportedAt, base) || inPeriod(a.statusSince, base);
  const people = input.agents
    .filter((a) => a.startedAt <= until && (news(a) || isActive(a.status) || needsYou(stateOf(a, base))))
    .sort((a, b) => Number(b.kind === 'lead') - Number(a.kind === 'lead') || a.startedAt - b.startedAt || order(a.key, b.key));
  const nothingNew = activity.length === 0 && !input.agents.some((a) => inPeriod(a.reportedAt, base) || inPeriod(a.statusSince, base));
  const ctx: Context = { ...base, leads: people.filter((a) => a.kind === 'lead').length };

  const studioName = clean(input.studioName, 80) || 'the studio';
  const header = [
    `Catch-up account for ${studioName}, from ${beforeNow(since, until)} to now.`,
    '"You" is the person who runs the studio. Times count back from now. Costs are API-equivalent estimates unless marked reported, and cover each person\'s whole shift so far.',
    ...(nothingNew ? ['Nothing new happened in this period.'] : []),
  ].join('\n');
  const sections = [
    header,
    needsYouSection(people, ctx),
    peopleSection(people, ctx),
    gatesSection(input.gateRuns, input.agents, input.studio, ctx),
    costSection(people, input.agents),
  ];
  // Every piece was masked as it went in; a pass over the whole text catches anything that spans pieces. That pass can
  // lengthen the text (a private key cut short gets its END line back), so it comes before the fitting: the oldest
  // activity lines make the room, never the newest ones at the end.
  let room = ACCOUNT_MAX_CHARS - sections.reduce((sum, s) => sum + s.length + 2, 0);
  const write = () => redactSecrets([...sections, activitySection(activity, ctx, room)].join('\n\n'));
  let text = write();
  for (let tries = 0; text.length > ACCOUNT_MAX_CHARS && tries < 8; tries++) {
    room -= text.length - ACCOUNT_MAX_CHARS;
    text = write();
  }
  return { text: text.length > ACCOUNT_MAX_CHARS ? redactClip(text, ACCOUNT_MAX_CHARS) : text, nothingNew, since, until };
}
