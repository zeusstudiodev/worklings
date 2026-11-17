// What each person in a company is doing, in the words People, Now, the inbox and a person's panel share
// (docs/design-v3.md, "People and a person": the desk-and-work table), how the office names them, and the org as an
// outline. Pure, so it can be tested; the components only draw it.
import { endsInQuestion, isPlainPerson, PLAIN_TITLE } from '../../../../src/core/plain.ts';
import {
  type Approval,
  type CompanyView,
  introduce,
  type PersonView,
  type Question,
  type Report,
  STAKEHOLDER,
  type Task,
  THE_OFFICE,
} from '../../../../src/core/company.ts';
import { agentCost, type AgentState } from '../../../../src/core/office.ts';
import { clip, coarseDuration, personRow, personState, plainText } from '../../../../src/core/now.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { inSentence, titleFromId } from '../../../../src/core/studio.ts';
import { capital, nameOnTeam, severalLeads } from '../../../../src/core/words.ts';
import { STATE_TEXT } from '../../hud/model.ts';
import { hourMinute } from '../../lib/format.ts';

/** The tones a state pill takes (the shared StatePill's): the words carry the state, the tone backs them up. */
export type Tone = 'working' | 'needs' | 'waiting' | 'error' | 'rest' | 'done' | 'neutral';

type Named = Pick<PersonView, 'name' | 'title' | 'level'>;

/** A person after the first mention: "Ada", "the QA engineer" for a role without a name, and always "the CEO". */
export function called(p: Named): string {
  if (isPlainPerson(p)) return PLAIN_TITLE;
  if (p.level === 'ceo') return 'the CEO';
  return p.name === p.title ? `the ${inSentence(p.title)}` : p.name;
}

/** A person the first time a row or sentence names them: "Ada, head of design", "the QA engineer", "the CEO". */
export function introduced(p: Named): string {
  if (isPlainPerson(p)) return PLAIN_TITLE;
  return p.level === 'ceo' ? 'the CEO' : introduce(p);
}

/** Their manager in the company, if they have one there. */
export const managerOrNull = (company: Pick<CompanyView, 'people'>, p: Pick<PersonView, 'reportsTo'>): PersonView | null =>
  (p.reportsTo === null ? undefined : company.people.find((m) => m.id === p.reportsTo)) ?? null;

/** "Kai's", "the CEO's": whose next step, whose desk. */
export const possessive = (name: string): string => `${name}'s`;

/**
 * A person introduced as a sentence's subject, with the comma that closes "Ada, head of design," before the verb:
 * "Ada, head of design, asks you." but "The QA engineer asks you."
 */
export function subject(p: Named): string {
  const intro = introduced(p);
  return intro.includes(',') ? `${intro},` : intro;
}

/** Someone by id: a person, you, the office, or (for someone no longer in the company) their id in words. */
export function nameOf(company: Pick<CompanyView, 'people'>, id: string): { called: string; introduced: string; subject: string; person: PersonView | null } {
  if (id === STAKEHOLDER) return { called: 'you', introduced: 'you', subject: 'you', person: null };
  // The office asks too (the "start?" before a task on "check with me") and passes things on: it isn't anyone.
  if (id === THE_OFFICE) return { called: 'the office', introduced: 'the office', subject: 'the office', person: null };
  const person = company.people.find((p) => p.id === id) ?? null;
  if (person) return { called: called(person), introduced: introduced(person), subject: subject(person), person };
  const title = `the ${inSentence(titleFromId(id))}`;
  return { called: title, introduced: title, subject: title, person: null };
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** A place in line: "second", "twelfth", then "13th", "21st". */
export function ordinal(n: number): string {
  const word = ORDINALS[n - 1];
  if (word) return word;
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Text a person wrote, as a row shows it: Markdown marks gone, masked again, one line, cut at a word. */
export const shown = (text: string, max?: number): string => clip(plainText(text), max);

/** The first sentence of what someone wrote, for a row: "Card renders and is wired to the store." */
export function firstSentence(text: string, max = 160): string {
  const line = plainText(text).replace(/\s+/g, ' ').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  return clip(sentence, max);
}

/** Ends a fragment as a sentence, unless it already ends like one. */
export const endSentence = (text: string): string => (/[.?!…]$/.test(text) ? text : `${text}.`);

/** A summary inside a sentence: "Push the work branch to GitHub" -> "push the work branch to GitHub". */
export const inLine = (text: string): string => inSentence(shown(text)).replace(/[.\s]+$/, '');

// ---------------------------------------------------------------------------------------------------------------
// Open items: what waits on the stakeholder

export const isOpenQuestion = (q: Question): boolean => q.answer === null && q.withdrawn === null;
/** An approval still waits until its hook gives up at `expiresAt`, when it counts as a no. */
export const isOpenApproval = (a: Approval, now: number): boolean => a.answer === null && a.withdrawn === null && now < a.expiresAt;

export type WaitItem = { kind: 'question'; question: Question } | { kind: 'approval'; approval: Approval };

export const waitId = (w: WaitItem): string => (w.kind === 'question' ? w.question.id : w.approval.id);
export const waitAt = (w: WaitItem): number => (w.kind === 'question' ? w.question.askedAt : w.approval.askedAt);
export const waitPerson = (w: WaitItem): string => (w.kind === 'question' ? w.question.from : w.approval.person);

/** Everything open, longest waiting first. */
export function openItems(company: Pick<CompanyView, 'questions' | 'approvals'>, now: number): WaitItem[] {
  const items: WaitItem[] = [
    ...company.questions.filter(isOpenQuestion).map((question) => ({ kind: 'question' as const, question })),
    ...company.approvals.filter((a) => isOpenApproval(a, now)).map((approval) => ({ kind: 'approval' as const, approval })),
  ];
  return items.sort((x, y) => waitAt(x) - waitAt(y) || (waitId(x) < waitId(y) ? -1 : waitId(x) > waitId(y) ? 1 : 0));
}

/** What someone waits on you for, oldest first. */
export const waitsOf = (company: Pick<CompanyView, 'questions' | 'approvals'>, person: string, now: number): WaitItem[] =>
  openItems(company, now).filter((w) => waitPerson(w) === person);

// ---------------------------------------------------------------------------------------------------------------
// The desk-and-work table

export type WorkKind = 'away' | 'needs-ok' | 'needs-answer' | 'stuck' | 'blocked' | 'working' | 'waiting' | 'starting' | 'stopping' | 'paused' | 'idle' | 'off';

export interface Work {
  kind: WorkKind;
  /** The state in a word or two: "Working", "Needs your OK", "Waiting for a desk". */
  word: string;
  tone: Tone;
  /** The row's line: "Has work and waits for a desk, second in line." */
  line: string;
  /** Stuck: why the last turn failed, on its own line. */
  problem: string | null;
  /** What they wait on you for, so the row can offer Answer. */
  item: string | null;
  /** Since when this holds, for ordering rows. */
  since: number;
}

/** A failed turn reads as work going on for this long (v2's 30 s), so a failed step doesn't make anyone look stuck. */
export const STUCK_AFTER_MS = 30_000;
/** A status line older than this says how long it has stood: "…, for 12 min." */
export const STATUS_AGE_SHOWN_MS = 10 * 60_000;

const WORDS: Record<WorkKind, { word: string; tone: Tone }> = {
  away: { word: 'In Claude Code', tone: 'rest' },
  'needs-ok': { word: 'Needs your OK', tone: 'needs' },
  'needs-answer': { word: 'Needs your answer', tone: 'needs' },
  stuck: { word: 'Stuck', tone: 'error' },
  blocked: { word: 'Blocked', tone: 'error' },
  working: { word: 'Working', tone: 'working' },
  waiting: { word: 'Waiting for a desk', tone: 'waiting' },
  starting: { word: 'Starting', tone: 'working' },
  stopping: { word: 'Stopping', tone: 'working' },
  paused: { word: 'Paused', tone: 'neutral' },
  idle: { word: 'Idle', tone: 'neutral' },
  off: { word: 'Off duty', tone: 'neutral' },
};

export const taskOf = (company: Pick<CompanyView, 'tasks'>, id: string | null): Task | undefined => (id === null ? undefined : company.tasks.find((t) => t.id === id));

/** Their newest report, or the newest about one task. */
export function latestReport(company: Pick<CompanyView, 'reports'>, person: string, taskId?: string): Report | undefined {
  let latest: Report | undefined;
  for (const r of company.reports) {
    if (r.person !== person || (taskId !== undefined && r.taskId !== taskId)) continue;
    if (!latest || r.at >= latest.at) latest = r;
  }
  return latest;
}

/** The status line, with how long it has stood once that is worth saying: "Wiring the streak card, for 12 min." */
function statusWithAge(text: string, at: number, now: number): string {
  const line = shown(text);
  if (now - at <= STATUS_AGE_SHOWN_MS) return endSentence(line);
  const age = coarseDuration(now - at);
  return /[?!…]$/.test(line) ? `${line} For ${age}.` : `${line.replace(/\.$/, '')}, for ${age}.`;
}

/** "Waiting for your OK: push to GitHub. 3 min." or "Waiting for your answer: Which provider? 3 min." */
export function waitLine(w: WaitItem, now: number): string {
  const waited = `${capital(coarseDuration(now - waitAt(w)))}.`;
  if (w.kind === 'approval') return `Waiting for your OK: ${clip(inLine(w.approval.summary), 110)}. ${waited}`;
  // v0.8: a plain session's last words that ask nothing wait for a reply, not an answer.
  const reply = w.question.plainTurn === true && !endsInQuestion(w.question.text);
  return `Waiting for your ${reply ? 'reply' : 'answer'}: ${endSentence(shown(w.question.text, 110))} ${waited}`;
}

/** What someone is doing and what their row says, from their desk, their task and what waits on you. */
export function workOf(company: CompanyView, p: PersonView, now: number): Work {
  const make = (kind: WorkKind, line: string, since: number, extra: Partial<Pick<Work, 'problem' | 'item'>> = {}): Work => ({
    kind,
    ...WORDS[kind],
    line,
    since,
    problem: extra.problem ?? null,
    item: extra.item ?? null,
  });
  const { desk } = p;
  const task = taskOf(company, p.task);
  const status = p.status ? statusWithAge(p.status.text, p.status.at, now) : null;
  const onIt = task ? `On it: ${endSentence(shown(task.title))}` : 'On it.';

  if (desk.state === 'away') return make('away', `With you in Claude Code since ${hourMinute(desk.since)}.`, desk.since);
  const [waits] = waitsOf(company, p.id, now);
  const failedFor = now - desk.since;
  const crashed = desk.state === 'failed' && failedFor >= STUCK_AFTER_MS;
  const why = desk.problem ? endSentence(shown(desk.problem)) : null;
  if (waits) {
    // A crash behind an open question is said too: answering won't show it, and the person may not come back by themselves.
    const alsoStuck = crashed ? [`Also stuck for ${coarseDuration(failedFor)}.`, why].filter(Boolean).join(' ') : null;
    const work = make(waits.kind === 'approval' ? 'needs-ok' : 'needs-answer', waitLine(waits, now), waitAt(waits), { item: waitId(waits), problem: alsoStuck });
    // v0.8: a plain session's last words that ask nothing: it is the person's turn, not a question to answer.
    return waits.kind === 'question' && waits.question.plainTurn === true && !endsInQuestion(waits.question.text) ? { ...work, word: 'Your turn' } : work;
  }
  if (crashed) {
    // Stuck is a dead end without a way on: the office restarts a failed desk when it gets a message.
    return make('stuck', `Stuck for ${coarseDuration(failedFor)}.`, desk.since, { problem: [why, `Send ${called(p)} a message to try again.`].filter(Boolean).join(' ') });
  }
  const atDesk = desk.state === 'working' || desk.state === 'starting' || desk.state === 'stopping' || desk.state === 'failed';
  if (task?.status === 'blocked' && !atDesk) {
    const report = latestReport(company, p.id, task.id);
    const why = report?.outcome === 'blocked' ? firstSentence(report.text) : status;
    return make('blocked', why ?? `Blocked on ${endSentence(shown(task.title))}`, task.updatedAt);
  }
  // Their task is paused (by you or a manager) and their desk has let go of it: held until it is resumed.
  if (task?.paused && task.status !== 'done' && task.status !== 'dropped' && !atDesk && desk.state !== 'waiting') {
    return make('paused', `Their task is paused: ${endSentence(shown(task.title))}`, task.paused.at);
  }
  switch (desk.state) {
    case 'working':
    case 'failed':
      return make('working', status ?? onIt, desk.since);
    case 'starting':
      return make('starting', status ?? onIt, desk.since);
    case 'stopping':
      return make('stopping', status ?? 'Stopping after this step.', desk.since);
    case 'waiting':
      return make('waiting', `Has work and waits for a desk${desk.queue ? `, ${ordinal(desk.queue)} in line` : ''}.`, desk.since);
    case 'idle': {
      const report = latestReport(company, p.id);
      return make('idle', `Done for now.${report ? ` Last report at ${hourMinute(report.at)}.` : ''}`, desk.since);
    }
    case 'closed': {
      const open = task && task.status !== 'done' && task.status !== 'dropped';
      return make('off', open ? (status ?? `Task: ${endSentence(shown(task.title))}`) : 'Nothing assigned.', desk.since);
    }
  }
}

/** At work, or about to be: what the Now board's Working group holds, and what keeps a folded room open. */
export const isAtWork = (w: Work): boolean => w.kind === 'working' || w.kind === 'starting' || w.kind === 'stopping';
export const needsYou = (w: Work): boolean => w.kind === 'needs-ok' || w.kind === 'needs-answer';

// ---------------------------------------------------------------------------------------------------------------
// Rooms

export function roomName(snapshot: Pick<Snapshot, 'studio'>, room: string): string {
  return snapshot.studio?.departments.find((d) => d.id === room)?.name ?? titleFromId(room);
}

// ---------------------------------------------------------------------------------------------------------------
// The org as an outline (People): you, the CEO, the office manager, each head under their room's name, then team leads
// and workers, a level in per manager.

export interface OrgNode {
  person: PersonView;
  /** 1 for the CEO (you are 0), one more per manager. */
  depth: number;
  /** Heads show under their room's name. */
  room: { id: string; name: string } | null;
  children: OrgNode[];
}

const LEVEL_ORDER: Record<PersonView['level'], number> = { ceo: 0, worker: 1, lead: 2, head: 3 };

/** Who goes first among someone's reports: the office manager, then workers, team leads and heads, in studio order. */
function rank(p: PersonView): number {
  return p.id === 'office-manager' ? -1 : LEVEL_ORDER[p.level];
}

export function orgOutline(snapshot: Pick<Snapshot, 'studio'>, company: Pick<CompanyView, 'people'>): OrgNode[] {
  const people = company.people;
  const order = new Map(people.map((p, i) => [p.id, i]));
  const ids = new Set(people.map((p) => p.id));
  const reports = new Map<string, PersonView[]>();
  for (const p of people) {
    if (p.reportsTo === null || !ids.has(p.reportsTo) || p.reportsTo === p.id) continue;
    reports.set(p.reportsTo, [...(reports.get(p.reportsTo) ?? []), p]);
  }
  const placed = new Set<string>();
  const node = (p: PersonView, depth: number): OrgNode => {
    placed.add(p.id);
    const kids = [...(reports.get(p.id) ?? [])].sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const children: OrgNode[] = [];
    // One at a time, so a loop in a broken org can't place anyone twice.
    for (const k of kids) if (!placed.has(k.id)) children.push(node(k, depth + 1));
    return { person: p, depth, room: p.level === 'head' ? { id: p.room, name: roomName(snapshot, p.room) } : null, children };
  };
  const out: OrgNode[] = [];
  const ceo = people.find((p) => p.level === 'ceo');
  if (ceo) out.push(node(ceo, 1));
  // Anyone the tree didn't reach (a studio without an org, a manager who left): by room, under the room's name.
  for (const room of [...new Set(people.filter((p) => !placed.has(p.id)).map((p) => p.room))]) {
    let first = true;
    for (const p of people) {
      if (p.room !== room || placed.has(p.id)) continue;
      // Someone whose manager is still to come is placed under them instead.
      if (p.reportsTo !== null && ids.has(p.reportsTo) && p.reportsTo !== p.id && !placed.has(p.reportsTo)) continue;
      const n = node(p, 1);
      out.push(first ? { ...n, room: { id: room, name: roomName(snapshot, room) } } : n);
      first = false;
    }
  }
  // A loop with nobody outside it (every manager waits on another): break it at the first person left.
  for (const p of people) if (!placed.has(p.id)) out.push(node(p, 1));
  return out;
}

/** Everyone in a subtree, the node first. */
export function flatten(nodes: readonly OrgNode[]): OrgNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Find shows from this many people; rooms fold to their head from FOLD_OVER. */
export const FIND_OVER = 12;
export const FOLD_OVER = 25;

/** Lower case without accents, so "Lea" finds "Léa". */
const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** People whose name, title or room matches, in outline order. */
export function findPeople(snapshot: Pick<Snapshot, 'studio'>, nodes: readonly OrgNode[], query: string): OrgNode[] {
  const q = searchable(query.trim());
  if (!q) return flatten(nodes);
  return flatten(nodes).filter(({ person: p }) => [p.name, p.title, roomName(snapshot, p.room)].some((field) => searchable(field).includes(q)));
}

/** "4 of 31 people". */
export const foundLine = (found: number, total: number): string => `${found} of ${total} ${total === 1 ? 'person' : 'people'}`;

/** A room stays open when someone in it works, needs you or is stuck; otherwise, in a big company, it folds to its head. */
export function keepsOpen(company: CompanyView, node: OrgNode, now: number): boolean {
  return flatten(node.children).some(({ person }) => {
    const w = workOf(company, person, now);
    return isAtWork(w) || needsYou(w) || w.kind === 'stuck';
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Visitors: sessions the company didn't start, as v2 shows them

export interface VisitorRow {
  key: string;
  name: string;
  word: string;
  line: string;
  cost: number;
}

/** Sessions in the project's folder that aren't anyone's desk, nor a subagent of one, newest first. */
export function visitorsOf(snapshot: Pick<Snapshot, 'agents'>, company: Pick<CompanyView, 'people'>, now: number): VisitorRow[] {
  const sessions = new Set(company.people.map((p) => p.desk.sessionId).filter((s): s is string => s !== null));
  const keys = new Set(company.people.map((p) => p.agentKey).filter((k): k is string => k !== null));
  const visitors: AgentState[] = snapshot.agents.filter((a) => !keys.has(a.key) && !sessions.has(a.sessionId)).sort((a, b) => b.lastEventAt - a.lastEventAt);
  const several = severalLeads(visitors);
  return visitors.map((a) => ({
    key: a.key,
    name: nameOnTeam(a, several),
    word: STATE_TEXT[personState(a, now).kind],
    line: personRow({ agents: visitors }, a, now).status,
    cost: agentCost(a),
  }));
}
