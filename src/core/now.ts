// What each person is doing, in outcome words: the states the Now board, the headline and the bubbles share
// (docs/design.md, "What a person is doing, in plain words"). Pure, so the browser and the server agree.
import { type AgentKind, type AgentState, agentCost, isActive } from './office.ts';
import { redactSecrets } from './redact.ts';
import { capital, nameInSentence, nameOnTeam, severalLeads } from './words.ts';

/** An error that clears within this long reads as "on it", so a failed command doesn't make anyone look stuck. */
export const STUCK_AFTER_MS = 30_000;
/** A step that runs longer than this is worth a quiet mention ("Busy with one step for 4 min"). */
export const LONG_STEP_MS = 60_000;

export type PersonState =
  /** A permission prompt is open: `what` it asks to do, e.g. "run npm install". */
  | { kind: 'needs-ok'; since: number; what: string }
  /** An AskUserQuestion, an elicitation or an agent-needs-input notice is open; the question when the office saw it. */
  | { kind: 'needs-answer'; since: number; question: string | null }
  | { kind: 'stuck'; since: number; error: string }
  /** The lead's last word, or a subagent's report, ends with a question. */
  | { kind: 'has-question'; since: number; question: string }
  /** Working or thinking; `step` is a single tool call that has run longer than LONG_STEP_MS. */
  | { kind: 'on-it'; since: number; step: { phrase: string; since: number } | null }
  /** Reported back (a subagent) or ended its turn (the lead), with what it said. */
  | { kind: 'done'; since: number; result: string | null }
  | { kind: 'idle'; since: number };

export type PersonStateKind = PersonState['kind'];

/** States that need the person. The headline and the Needs you group each order them their own way (docs/design.md). */
export const NEEDS_YOU: readonly PersonStateKind[] = ['needs-ok', 'needs-answer', 'stuck', 'has-question'];

export function personState(a: AgentState, now: number): PersonState {
  if (a.status === 'waiting' && a.waitingFor) return { kind: 'needs-ok', since: a.statusSince, what: a.waitingFor };
  if (a.question?.source === 'ask') return { kind: 'needs-answer', since: a.question.at, question: a.question.text };
  if (a.status === 'waiting') return { kind: 'needs-answer', since: a.statusSince, question: null };
  const stuck = a.status === 'error' && (a.errorFrom === 'turn' || now - a.statusSince >= STUCK_AFTER_MS);
  if (stuck) return { kind: 'stuck', since: a.statusSince, error: a.error ?? 'Something failed' };
  if (a.question?.source === 'message') return { kind: 'has-question', since: a.question.at, question: a.question.text };
  if (isActive(a.status)) {
    const step = a.tool && now - a.tool.since > LONG_STEP_MS ? { phrase: a.tool.phrase, since: a.tool.since } : null;
    return { kind: 'on-it', since: a.busySince, step };
  }
  if (a.status === 'done' || (a.status === 'idle' && a.reportedAt !== null)) {
    return { kind: 'done', since: a.endedAt ?? a.reportedAt ?? a.statusSince, result: a.lastMessage };
  }
  return { kind: 'idle', since: a.statusSince };
}

export const needsYou = (state: PersonState): boolean => NEEDS_YOU.includes(state.kind);

/** Most urgent first: who a role's badge and Team row speak for when it has several calls. */
const URGENCY: readonly PersonStateKind[] = ['needs-ok', 'needs-answer', 'stuck', 'has-question', 'on-it', 'done', 'idle'];

/** The call a role shows: whoever needs you, then whoever is stuck, asking, at work or done; the latest wins a tie. */
export function mostUrgent(agents: AgentState[], now: number): { agent: AgentState; state: PersonState } | null {
  let best: { agent: AgentState; state: PersonState; rank: number } | null = null;
  for (const agent of agents) {
    const state = personState(agent, now);
    const rank = URGENCY.indexOf(state.kind);
    if (!best || rank < best.rank || (rank === best.rank && agent.lastEventAt > best.agent.lastEventAt)) best = { agent, state, rank };
  }
  return best && { agent: best.agent, state: best.state };
}

/** What someone is trying to get done: a subagent's brief, or the lead's request. */
export const goalOf = (a: AgentState): string | null => (a.agentId ? a.task : a.purpose);

// The Now board (docs/design.md, "The headline" and "The Now tab"), built only from what the office already has.

/** Someone who reported back stays in Done this long, then folds away with everyone else who worked earlier. */
export const DONE_FOR_MS = 15 * 60_000;
/** Rows the fold lists before the rest become a count. */
export const FOLD_ROWS = 20;
/** Lines are cut here, and a result at RESULT_CHARS, so a screen reader never reads out a pasted log. */
export const LINE_CHARS = 160;
export const RESULT_CHARS = 240;

/** What the board reads from a snapshot. */
export interface NowSource {
  agents: AgentState[];
}

/** One person (one call of a role) on the board, in the lines the design gives a row. */
export interface NowRow {
  key: string;
  kind: AgentKind;
  roleId: string | null;
  /** As Team names them: "QA engineer", "Lead, session 3f2a1c", "Explore". */
  name: string;
  /** As a sentence names them: "the QA engineer", "the lead in session 3f2a1c", "the Explore agent". */
  called: string;
  state: PersonState;
  /** What they are trying to get done, as written. */
  goal: string | null;
  /** A subagent's "For your request: …"; null for the lead, or when the request is unknown. */
  request: string | null;
  /** The state in outcome words: "Needs your OK to run npm install. Waiting 3 min." */
  status: string;
  /** What they said when done or asking (left out when it is only the question), or the error they are stuck on. */
  result: string | null;
  /** Small facts, only when true: "Busy with one step for 4 min", "3 files changed", "Wasn't allowed to run npm install". */
  facts: string[];
  cost: number;
}

export interface NowBoard {
  /** Up to three sentences: who needs you, who is at work and on what, the latest report. */
  headline: string[];
  /** The headline's first two sentences, for the caption over the scene. */
  caption: string[];
  /** Needs your OK or answer (longest waiting first), stuck (longest first), has a question (newest first). */
  needsYou: NowRow[];
  /** By session, the one where work most recently started first; its lead, then its people, newest first. */
  onIt: NowRow[];
  /** Done in the last DONE_FOR_MS, newest first. */
  done: NowRow[];
  /** Everyone else who has worked, newest first: up to FOLD_ROWS rows, then how many more. */
  earlier: { rows: NowRow[]; more: number };
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** A count in a sentence: words from one to twelve, numerals from 13. */
export const countWord = (n: number): string => WORDS[n] ?? String(n);

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Emphasis around words (**done**, _this_), but not the underscores inside snake_case. Each mark strips only itself, so
 * `**API_KEY**` keeps its underscore and `_a*b_` its star.
 */
const unemphasize = (text: string) =>
  text
    .replace(/(^|[^\w*])(\*\*|\*)(?=\S)([^*\n]*?\S)\2(?![\w*])/g, '$1$3')
    .replace(/(^|[^\w])(__|_)(?=\S)([^_\n]*?\S)\2(?![\w])/g, '$1$3');

/**
 * Text as the office shows it: Markdown's code and emphasis marks go, what was inside code stays as it was, and the
 * result is masked again, since a mark around a value ("token: `a1b2c3`") can hide its shape from earlier masking.
 */
export function plainText(text: string): string {
  return redactSecrets(
    text
      .split(/(`[^`\n]*`)/)
      .map((part, i) => (i % 2 === 1 ? part.slice(1, -1) : unemphasize(part)))
      .join('')
      .replaceAll('`', ''),
  );
}

/** How long, coarsely: "under a minute", "12 min", "1 h 5 min". */
export function coarseDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest > 0 ? ` ${rest} min` : ''}`;
}

/** How long ago, coarsely: "just now", "4 min ago", "2 h ago", "3 days ago". */
export function coarseAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** One line of text: whitespace collapsed, cut to `max` characters with "…", at a word when one ends near the cut. */
export function clip(text: string, max = LINE_CHARS): string {
  const line = flat(text);
  if (line.length <= max) return line;
  const room = line.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  return `${(space > max * 0.6 ? room.slice(0, space) : room).replace(/[\s,;:.-]+$/, '')}…`;
}

/** A request as the headline quotes it: its first sentence, eight words at most, with "…" inside the quotes when cut. */
export function quote(text: string): string {
  const firstLine = flat(plainText(text).trim().split('\n')[0] ?? '');
  const sentence = /^.*?[.!?](?=\s|$)/.exec(firstLine)?.[0] ?? firstLine;
  const words = sentence.split(' ');
  const cut = words.length > 8 || /[,;:]$/.test(sentence);
  const body = words.slice(0, 8).join(' ').replace(cut ? /[\s,;:.!?-]+$/ : /\.$/, '');
  return `“${body}${cut ? '…' : ''}”`;
}

/** Names as Team shows them and as sentences say them (see words.ts); with more than one session, leads say which. */
function naming(agents: AgentState[]) {
  const several = severalLeads(agents);
  return {
    name: (a: AgentState) => nameOnTeam(a, several),
    called: (a: AgentState) => nameInSentence(a, several),
  };
}

/** Whether someone has done anything yet: roles that never worked stay on Team. */
const hasWorked = (a: AgentState) => a.status !== 'idle' || a.requests > 0 || a.toolCalls > 0 || a.reportedAt !== null;

const endSentence = (text: string) => (/[.?!…]$/.test(text) ? text : `${text}.`);

/** "Head <middle>. Tail." with the middle cut so the line stays within LINE_CHARS. */
function fit(head: string, middle: string, tail: string): string {
  return `${endSentence(`${head}${clip(middle, LINE_CHARS - head.length - tail.length - 1)}`)}${tail}`;
}

function statusLine(s: PersonState, now: number): string {
  switch (s.kind) {
    case 'needs-ok':
      return fit('Needs your OK to ', plainText(s.what), ` Waiting ${coarseDuration(now - s.since)}.`);
    case 'needs-answer':
      return s.question
        ? fit('Needs your answer: ', plainText(s.question), ` Waiting ${coarseDuration(now - s.since)}.`)
        : `Needs your answer in Claude Code. Waiting ${coarseDuration(now - s.since)}.`;
    case 'stuck':
      return `Stuck for ${coarseDuration(now - s.since)}.`;
    case 'has-question':
      return fit('Has a question: ', plainText(s.question), ` Asked ${coarseAge(now - s.since)}.`);
    case 'on-it':
      return `On it for ${coarseDuration(now - s.since)}.`;
    case 'done':
      return `Done ${coarseAge(now - s.since)}.`;
    case 'idle':
      return `Last active ${coarseAge(now - s.since)}.`;
  }
}

/** Compares a message with a question without the Markdown and quotes around them. */
const plain = (text: string) => flat(text.replace(/[*_`"'“”]/g, '')).toLowerCase();

/** What they said, as a row shows it: agents sometimes start in lower case. */
const said = (text: string) => capital(clip(plainText(text), RESULT_CHARS));

function resultOf(a: AgentState, s: PersonState): string | null {
  if (s.kind === 'stuck') return clip(plainText(s.error));
  if (s.kind === 'done') return s.result ? said(s.result) : null;
  if (s.kind === 'has-question' && a.lastMessage && plain(a.lastMessage) !== plain(s.question)) return said(a.lastMessage);
  return null;
}

function factsOf(a: AgentState, s: PersonState, now: number): string[] {
  const facts: string[] = [];
  if (s.kind === 'on-it' && s.step) facts.push(`Busy with one step for ${coarseDuration(now - s.step.since)}`);
  if (a.files.length > 0) facts.push(`${a.files.length} ${a.files.length === 1 ? 'file' : 'files'} changed`);
  // The reducer forgets the lead's refusal at the person's next request, so what is left belongs to the current one.
  if (a.refused) facts.push(clip(`Wasn't allowed to ${plainText(a.refused.what)}`));
  return facts;
}

type Naming = ReturnType<typeof naming>;

function rowOf(a: AgentState, now: number, names: Naming): NowRow {
  const state = personState(a, now);
  const goal = goalOf(a);
  return {
    key: a.key,
    kind: a.kind,
    roleId: a.roleId,
    name: names.name(a),
    called: names.called(a),
    state,
    goal: goal ? clip(plainText(goal)) : null,
    request: a.agentId && a.purpose ? clip(`For your request: ${plainText(a.purpose)}`) : null,
    status: statusLine(state, now),
    result: resultOf(a, state),
    facts: factsOf(a, state, now),
    cost: agentCost(a),
  };
}

/** The board's lines for one person, for their badge. */
export function personRow(source: NowSource, a: AgentState, now: number): NowRow {
  return rowOf(a, now, naming(source.agents));
}

/**
 * One clause of the first sentence: one or two names, then a count. Names it uses go into `named`. Two calls of one
 * role read as "two QA engineers".
 */
function clause(rows: NowRow[], one: (r: NowRow) => string, several: string, named: Set<string>): string | null {
  const [first, second] = rows;
  if (!first) return null;
  if (rows.length > 2) return `${countWord(rows.length)} people ${several}`;
  for (const r of rows) named.add(r.key);
  if (!second) return `${first.called} ${one(first)}`;
  if (first.called === second.called) return `two ${first.called.replace(/^(the|a) /, '')}s ${several}`;
  return `${first.called} and ${second.called} ${several}`;
}

function whoNeedsYou(rows: NowRow[]): { sentence: string | null; named: Set<string> } {
  const named = new Set<string>();
  const of = (...kinds: PersonStateKind[]) => rows.filter((r) => kinds.includes(r.state.kind));
  const clauses = [
    clause(of('needs-ok', 'needs-answer'), (r) => (r.state.kind === 'needs-ok' ? 'needs your OK' : 'needs your answer'), 'need you', named),
    clause(of('has-question'), (r) => (r.kind === 'lead' ? 'has a question for you' : 'has a question'), 'have questions', named),
    clause(of('stuck'), () => 'is stuck', 'are stuck', named),
  ].filter((c): c is string => c !== null);
  const last = clauses.pop();
  if (last === undefined) return { sentence: null, named };
  return { sentence: `${capital(clauses.length > 0 ? `${clauses.join(', ')}, and ${last}` : last)}.`, named };
}

/**
 * The headline's first sentence for these rows, in the order of the Needs you group: "The backend engineer needs your
 * OK.", "Three people need you, and the lead is stuck." Null when nobody in them needs you.
 */
export const needsYouSentence = (rows: NowRow[]): string | null => whoNeedsYou(rows).sentence;

export function nowBoard(source: NowSource, now: number): NowBoard {
  const names = naming(source.agents);
  const people = source.agents.filter(hasWorked).map((a) => ({ a, row: rowOf(a, now, names) }));
  type Person = (typeof people)[number];
  const since = (p: Person) => p.row.state.since;
  const byKey = (x: Person, y: Person) => (x.a.key < y.a.key ? -1 : x.a.key > y.a.key ? 1 : 0);

  const urgency = (p: Person) => (p.row.state.kind === 'stuck' ? 1 : p.row.state.kind === 'has-question' ? 2 : 0);
  const needs = people
    .filter((p) => needsYou(p.row.state))
    .sort((x, y) => urgency(x) - urgency(y) || (urgency(x) === 2 ? since(y) - since(x) : since(x) - since(y)) || byKey(x, y));

  // Sessions by when work in them last started, not by their latest tool call, so rows don't hop on every step.
  const sessions = new Map<string, Person[]>();
  for (const p of people) if (p.row.state.kind === 'on-it') sessions.set(p.a.sessionId, [...(sessions.get(p.a.sessionId) ?? []), p]);
  const onIt = [...sessions]
    .map(([id, group]) => ({ id, group, started: Math.max(...group.map(since)) }))
    .sort((x, y) => y.started - x.started || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .flatMap(({ group }) => group.sort((x, y) => Number(y.a.kind === 'lead') - Number(x.a.kind === 'lead') || y.a.startedAt - x.a.startedAt || byKey(x, y)));

  const finished = people.filter((p) => !needsYou(p.row.state) && p.row.state.kind !== 'on-it').sort((x, y) => since(y) - since(x) || byKey(x, y));
  const done = finished.filter((p) => p.row.state.kind === 'done' && now - since(p) <= DONE_FOR_MS);
  const earlier = finished.filter((p) => !done.includes(p));

  const first = whoNeedsYou(needs.map((p) => p.row));
  const second = atWorkSentence(people.filter((p) => isActive(p.a.status)), first.named, people.length > 0);
  const reporter = people.filter((p) => p.a.reportedAt !== null).sort((x, y) => (y.a.reportedAt ?? 0) - (x.a.reportedAt ?? 0) || byKey(x, y))[0];
  const third = reporter && !first.named.has(reporter.a.key) ? `Last report ${coarseAge(now - (reporter.a.reportedAt ?? now))} from ${reporter.row.called}.` : null;
  const caption = first.sentence ? [first.sentence, second] : [second];

  return {
    headline: third ? [...caption, third] : caption,
    caption,
    needsYou: needs.map((p) => p.row),
    onIt: onIt.map((p) => p.row),
    done: done.map((p) => p.row),
    earlier: { rows: earlier.slice(0, FOLD_ROWS).map((p) => p.row), more: Math.max(0, earlier.length - FOLD_ROWS) },
  };
}

/** The second sentence: how many are at work (the top bar's figure) and on what. */
function atWorkSentence(atWork: { a: AgentState; row: NowRow }[], named: Set<string>, anyoneWorked: boolean): string {
  if (atWork.length === 0) return anyoneWorked ? 'Nobody is at work.' : 'Nobody is at work yet.';
  if (atWork.every((p) => named.has(p.a.key))) return 'Nobody else is at work.';
  const [only] = atWork;
  if (only && atWork.length === 1) {
    const goal = goalOf(only.a) ?? only.a.purpose;
    return `${capital(only.row.called)} is at work${goal ? ` on ${quote(goal)}` : ''}.`;
  }
  const requests = new Map<string, string>();
  for (const p of atWork) if (p.a.purpose) requests.set(plain(p.a.purpose), p.a.purpose);
  const count = capital(countWord(atWork.length));
  const [request] = requests.values();
  if (requests.size === 1 && request) return `${count} at work on ${quote(request)}.`;
  return requests.size > 1 ? `${count} at work on ${countWord(requests.size)} requests.` : `${count} at work.`;
}
