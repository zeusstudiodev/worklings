// The shell's words (docs/design-v3.md, "The top bar and the company's state", "Lobby", "Every panel"): a company's
// state as a pill and a sentence, the lobby's rows, the browser tab's title and what the live region says. Pure, so
// tests can check every case.
import type { AsideView } from '../../../src/core/aside.ts';
import {
  type CompanyPhase,
  type CompanySettings,
  type CompanyView,
  type LobbyCompany,
  type LobbyView,
  type Message,
  type Pause,
  type PersonView,
  type Question,
  STAKEHOLDER,
  THE_OFFICE,
} from '../../../src/core/company.ts';
import { countWord } from '../../../src/core/now.ts';
import { inSentence, titleFromId } from '../../../src/core/studio.ts';
import { capital } from '../../../src/core/words.ts';
import { ago, dollars, hourMinute } from '../lib/format.ts';
import { planWait } from './plan/planModel.ts';
import { waitsOf } from './people/peopleModel.ts';
import { draftState, scopingOf, scopingWaits } from './proposal/model.ts';
import { answerSentence } from './person/personModel.ts';
import type { StateTone } from './ui/tone.ts';

/** How a time of day reads ("14:00"); tests pass a fixed one. */
export type Clock = (at: number) => string;

/** A time for a pill, without the day period ("11:54" for 11:54 AM): the sentence beside it says it in full. */
export function shortTime(at: number): string {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
    .formatToParts(new Date(at))
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
}

/** A person in a sentence after the first mention: "Kai", "the CEO", or "the head of design" for a role without a name. */
export function shortName(p: Pick<PersonView, 'name' | 'title' | 'level'>): string {
  if (p.level === 'ceo') return 'the CEO';
  if (p.name && p.name !== p.title) return p.name;
  return `the ${inSentence(p.title)}`;
}

/**
 * What a conversation shows for a message. Your answer reaches the asker as "on "Q": A", words meant for them; here it
 * reads as the person panel says it, "You answered “Should a streak forgive one missed day?”: Forgive one day a week."
 */
export function shownText(m: Pick<Message, 'text' | 'answers'>, questions: readonly Question[]): string {
  return answerSentence({ questions: [...questions] }, { answers: m.answers ?? null, text: m.text }) ?? m.text;
}

/**
 * What the company has spent, for the ledger: what its people have cost, which outlives a restart of the office, and
 * the office's own Ask aside and Catch me up calls. v2's totals would start over with each office and count only the
 * transcripts it saw. Someone who was fired keeps what they cost (it was spent), so it comes from `spend.byPerson`.
 */
export function companySpend(company: Pick<CompanyView, 'people'> & { spend: Pick<CompanyView['spend'], 'byPerson'> }, aside: Pick<AsideView, 'spend'>): number {
  const here = new Set(company.people.map((p) => p.id));
  const left = company.spend.byPerson.filter((t) => !here.has(t.person) && t.person !== THE_OFFICE && t.person !== STAKEHOLDER);
  return company.people.reduce((sum, p) => sum + p.cost, 0) + left.reduce((sum, t) => sum + t.all, 0) + aside.spend.cost;
}

/** The ledger's money words, as the Spend dashboard has them: Spend on an API key, else an API-equivalent estimate. */
export function spendWords(billing: CompanySettings['billing'], pricesAsOf: string): { label: 'Spend' | 'API-equivalent'; title: string } {
  return billing === 'api-key'
    ? { label: 'Spend', title: 'What Claude Code reported for your API key.' }
    : { label: 'API-equivalent', title: `What the same tokens would cost on the Claude API, at list prices of ${pricesAsOf}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// The company's state

export interface StateInput {
  phase: CompanyPhase;
  pause: Pause | null;
  problem: string | null;
  working: number;
  waiting: number;
  /** The milestone people are on: the goal's first one not done. */
  milestone: string | null;
  /** The latest report, for an idle company: who sent it and when. */
  lastReport: { who: string; at: number } | null;
  /** Start was pressed: the company is hiring everyone and making its branch. */
  starting?: boolean;
  /** People whose turn is held for your OK or your answer: they are waiting for you, not at work (`working` leaves them out). */
  held?: number;
  /** The CEO's drafting failed: the founding company has stopped, not drafting. */
  draftFailed?: boolean;
  /** The CEO's scoping questions wait for your answers before it drafts. */
  scoping?: boolean;
  /** While founding, the CEO isn't drafting: you stopped it, or its turn ended without a proposal and it waits for you. */
  draftIdle?: 'stopped' | 'ended' | null;
  /** What the plan waits on you for ("The CEO's plan waits for your approval."), when it waits. */
  planWait?: string | null;
  /** v0.2: every task and milestone is done, so a company nobody works in is finished, not idle. */
  done?: boolean;
}

export interface CompanyState {
  pill: string;
  tone: StateTone;
  /** The headline's first sentence, and the lobby row's state. */
  sentence: string;
}

/** A company that rests or that you paused: the pill and the sentence, or null when it neither rests nor is paused. */
function pausedState(pause: Pause | null, clock: Clock, pillClock: Clock): CompanyState | null {
  if (!pause) return null;
  const until = pause.until;
  if (pause.reason === 'usage-limit') {
    return until === null
      ? { pill: 'Resting', tone: 'rest', sentence: "Resting until your plan's limit resets. Work picks up by itself." }
      : { pill: `Resting until ${pillClock(until)}`, tone: 'rest', sentence: `Resting until ${clock(until)}, when your plan's limit resets. Work picks up by itself.` };
  }
  if (pause.reason === 'overloaded') {
    return until === null
      ? { pill: 'Resting', tone: 'rest', sentence: 'Resting: Claude is overloaded.' }
      : { pill: `Resting until ${pillClock(until)}`, tone: 'rest', sentence: `Resting until ${clock(until)}: Claude is overloaded.` };
  }
  // The office's own sentence says whose budget it is and how much; it waits for the budget to be raised, not for a resume.
  if (pause.reason === 'budget') return { pill: 'Over budget', tone: 'needs', sentence: pause.message.trim() || "Paused: the company's budget is spent. Raise it to carry on." };
  return { pill: 'Paused by you', tone: 'rest', sentence: `You paused work at ${clock(pause.since)}.` };
}

/** The pill and the sentence for each phase and pause (the table in "The top bar and the company's state"). */
export function companyState(s: StateInput, now: number, clock: Clock = hourMinute, pillClock: Clock = clock === hourMinute ? shortTime : clock): CompanyState {
  if (s.problem) return { pill: "Can't run", tone: 'error', sentence: s.problem };
  if (s.phase === 'founding') {
    // A rest or a failed draft comes before "drafting": the CEO isn't drafting through either.
    const rest = pausedState(s.pause, clock, pillClock);
    if (rest) return rest;
    if (s.draftFailed) return { pill: "Couldn't draft", tone: 'error', sentence: "The CEO couldn't draft your company. Try again." };
    if (s.draftIdle === 'stopped') return { pill: 'Draft stopped', tone: 'neutral', sentence: 'You stopped the CEO. Draft again, or tell it what to change.' };
    if (s.draftIdle === 'ended') return { pill: 'Waiting for you', tone: 'needs', sentence: "The CEO's turn ended without a proposal. Answer it, or draft again." };
    if (s.scoping) return { pill: 'Questions for you', tone: 'needs', sentence: 'The CEO has a few questions before drafting your company.' };
    return { pill: 'Drafting the org', tone: 'working', sentence: 'The CEO is drafting your company.' };
  }
  if (s.phase === 'proposed' && s.starting) return { pill: 'Starting', tone: 'working', sentence: 'Hiring everyone and putting the project on its own branch.' };
  if (s.phase === 'proposed') return { pill: 'Proposal ready', tone: 'needs', sentence: "The CEO's proposal is ready for you." };
  if (s.phase === 'stopped') return { pill: 'Stopped', tone: 'neutral', sentence: 'Stopped. Nobody works until you resume it.' };
  const paused = pausedState(s.pause, clock, pillClock);
  if (paused) return paused;
  const held = s.held ?? 0;
  const planWait = s.planWait ?? null;
  const forYou = held > 0 ? ` ${capital(countWord(held))} ${held === 1 ? 'waits' : 'wait'} for you.` : '';
  const waits = s.waiting > 0 ? ` ${capital(countWord(s.waiting))} ${s.waiting === 1 ? 'waits' : 'wait'} for a desk.` : '';
  if (s.working > 0) {
    const on = s.milestone ? ` on “${s.milestone}”` : '';
    return { pill: 'Working', tone: 'working', sentence: `${capital(countWord(s.working))} at work${on}.${forYou}${planWait ? ` ${planWait}` : ''}${waits}` };
  }
  // Nobody works, but someone waits for you: that is what the company is doing, not "idle".
  if (held > 0 || planWait) return { pill: 'Waiting for you', tone: 'needs', sentence: held > 0 ? `Nobody is at work.${forYou}${planWait ? ` ${planWait}` : ''}${waits}` : `${planWait}${waits}` };
  const last = s.lastReport ? ` Last report ${ago(s.lastReport.at, now)} from ${s.lastReport.who}.` : '';
  if (s.done) return { pill: 'Done', tone: 'done', sentence: `Every task and milestone is done.${last}` };
  return { pill: 'Idle', tone: 'neutral', sentence: `Nobody is at work.${waits}${last}` };
}

/** Desks at work. A step held for your OK or your answer still holds its desk, but nobody is working on it. */
const AT_WORK_DESKS: readonly string[] = ['starting', 'working', 'stopping'];

/**
 * How many people at work are only waiting for you: an open approval or question of theirs holds their turn. The
 * office's "start?" before a task on "check with me" holds nobody: it is about a next task, and whoever owns it works on.
 */
export const heldCount = (c: Pick<CompanyView, 'people' | 'questions' | 'approvals'>, now: number): number =>
  c.people.filter((p) => AT_WORK_DESKS.includes(p.desk.state) && waitsOf(c, p.id, now).some((w) => !(w.kind === 'question' && w.question.gate))).length;

/** The people really at work, for the bar's ledger: the desks at work, less those held for you. */
export const workingNow = (c: Pick<CompanyView, 'people' | 'questions' | 'approvals' | 'desks'>, now: number): number => Math.max(0, c.desks.working - heldCount(c, now));

/** The state input from a company's full view. */
/** `now` is the office's clock (useOfficeClock), never this browser's: who is held for you depends on it. */
/**
 * Whether the inbox tops itself with the company's state sentence and its action: resting, paused, stopped or unable to
 * run, once the company is past its founding. Where it does, the phone's head leaves that sentence out so it reads once.
 */
export const showsStateCallout = (c: Pick<CompanyView, 'phase' | 'pause' | 'problem'>): boolean =>
  c.phase !== 'founding' && c.phase !== 'proposed' && (c.pause !== null || c.phase === 'stopped' || Boolean(c.problem));

/** The panel's own reading of a founding company whose CEO isn't drafting, so the top bar says what the panel says. */
function idleDraft(c: CompanyView): 'stopped' | 'ended' | null {
  const draft = draftState(c);
  return draft === 'stopped' || draft === 'ended' ? draft : null;
}

export function stateOfCompany(c: CompanyView, now: number): StateInput {
  const held = heldCount(c, now);
  const report = c.reports.reduce<CompanyView['reports'][number] | null>((latest, r) => (!latest || r.at > latest.at ? r : latest), null);
  const reporter = report ? c.people.find((p) => p.id === report.person) : undefined;
  return {
    phase: c.phase,
    pause: c.pause,
    problem: c.problem,
    working: Math.max(0, c.desks.working - held),
    held,
    waiting: c.desks.waiting,
    milestone: c.goal?.milestones.find((m) => m.doneAt === null)?.title ?? null,
    lastReport: report ? { who: reporter ? shortName(reporter) : 'someone', at: report.at } : null,
    starting: c.starting === true,
    draftFailed: c.phase === 'founding' && c.people.some((p) => p.level === 'ceo' && p.desk.state === 'failed'),
    scoping: c.phase === 'founding' && scopingWaits(scopingOf(c)),
    draftIdle: idleDraft(c),
    done: (c.done ?? null) !== null,
    planWait: planWait(c)?.sentence ?? null,
  };
}

/** The state input from a lobby entry, which carries less: no milestone, and the latest status line instead of a report. */
export const stateOfEntry = (c: LobbyCompany): StateInput => ({
  phase: c.phase, pause: c.pause, problem: c.problem, working: c.working, waiting: c.waiting, milestone: null, lastReport: null,
  starting: c.starting === true,
  draftFailed: c.phase === 'founding' && c.people.some((p) => p.id === 'ceo' && p.state === 'failed'),
  // Before the org, what needs you is the CEO's scoping questions.
  scoping: c.phase === 'founding' && c.needsYou > 0,
  done: c.summary?.stage === 'done',
});

// ---------------------------------------------------------------------------------------------------------------
// The lobby

/** A folder cut in the middle so its start and its name show: "C:\Users\…\plant-pal". */
export function cutMiddle(path: string, max = 34): string {
  if (path.length <= max) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]/).filter((p, i) => p !== '' || i === 0);
  if (parts.length <= 3) return `…${path.slice(-(max - 1))}`;
  const head = parts.slice(0, 2).join(sep) || sep;
  const tail = parts.at(-1) ?? '';
  const cut = `${head}${sep}…${sep}${tail}`;
  return cut.length <= max + 8 ? cut : `${head}${sep}…${tail.slice(-(max - head.length - 2))}`;
}

/** "Six of eight desks in use across companies." */
export const desksLine = (hub: LobbyView['hub']): string => `${capital(countWord(hub.working))} of ${countWord(hub.maxDesks)} desks in use across companies.`;

export interface LobbyRow {
  id: string;
  name: string;
  folder: string;
  state: CompanyState;
  /** "Kai: Wiring the streak card to the store." */
  latest: string | null;
  needsYou: number;
  /** "$4.20 spent" */
  spent: string;
}

/** Whose status line it is: their first name, which lobby entries carry; the role's title where an entry has none. */
function whoInLobby(c: Pick<LobbyCompany, 'people'>, id: string): string {
  const name = c.people.find((p) => p.id === id)?.name?.trim();
  if (name) return name;
  return id === 'ceo' ? 'The CEO' : titleFromId(id);
}

export function lobbyRow(c: LobbyCompany, now: number, clock: Clock = hourMinute): LobbyRow {
  return {
    id: c.id,
    name: c.name,
    folder: cutMiddle(c.root),
    state: companyState(stateOfEntry(c), now, clock),
    latest: c.latest ? `${whoInLobby(c, c.latest.person)}: ${c.latest.text}` : null,
    needsYou: c.needsYou,
    spent: c.spend > 0 ? `${dollars(c.spend)} spent` : 'Nothing spent yet',
  };
}

/** The companies by name, as the lobby lists them. */
export const byName = (companies: readonly LobbyCompany[]): LobbyCompany[] => [...companies].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

/** A problem every company shares, which stops Start: a usage limit on the account. */
export function hubProblem(lobby: LobbyView, clock: Clock = hourMinute): string | null {
  const running = lobby.companies.filter((c) => c.phase === 'running' && !c.problem);
  if (running.length === 0 || !running.every((c) => c.pause?.reason === 'usage-limit')) return null;
  const until = running.map((c) => c.pause?.until ?? null).filter((u): u is number => u !== null);
  return until.length > 0 ? `Your Claude usage limit was reached. Every company rests until ${clock(Math.max(...until))}.` : 'Your Claude usage limit was reached. Every company rests until it resets.';
}

/** What needs you everywhere: the lobby's total. */
export const totalNeeds = (lobby: LobbyView | null): number => lobby?.companies.reduce((s, c) => s + c.needsYou, 0) ?? 0;

/** What needs you in the other companies, for the Lobby link's count. */
export const otherNeeds = (lobby: LobbyView | null, company: string): number => lobby?.companies.filter((c) => c.id !== company).reduce((s, c) => s + c.needsYou, 0) ?? 0;

/** The browser tab: "(3) Plant Pal in Worklings", "(5) Worklings lobby". */
/** The browser tab's title: "(6) Org chart, Café Lumen in Worklings", the main view named unless it is the office. */
export const companyTitle = (name: string, count: number, view: string | null = null): string => `${count > 0 ? `(${count}) ` : ''}${view ? `${view}, ` : ''}${name} in Worklings`;
export const lobbyTitle = (count: number): string => `${count > 0 ? `(${count}) ` : ''}Worklings lobby`;

/** "Reconnecting to the office. This is how things stood at 14:32." */
export const reconnectingLine = (at: number, clock: Clock = hourMinute): string =>
  at > 0 ? `Reconnecting to the office. This is how things stood at ${clock(at)}.` : 'Reconnecting to the office.';

// ---------------------------------------------------------------------------------------------------------------
// What the live region says

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const withoutStop = (text: string) => text.replace(/[.!?]+$/, '');

/**
 * What became news between two views of a company: new questions and approvals for you, a reply to you, the proposal
 * arriving, rest falling and lifting. `prefix` names the company when it isn't the one on screen.
 */
export function companyNews(before: CompanyView, after: CompanyView, clock: Clock = hourMinute): string[] {
  const out: string[] = [];
  const person = (id: string) => after.people.find((p) => p.id === id) ?? before.people.find((p) => p.id === id);
  const said = (id: string) => {
    const p = person(id);
    return p ? capital(shortName(p)) : 'Someone';
  };
  const was = new Set([...before.approvals.map((a) => a.id), ...before.questions.map((q) => q.id)]);
  for (const a of after.approvals) if (!was.has(a.id) && !a.answer && !a.withdrawn) out.push(`${said(a.person)} needs your OK to ${lowerFirst(withoutStop(a.summary))}.`);
  for (const q of after.questions) if (!was.has(q.id) && !q.answer && !q.withdrawn) out.push(`${said(q.from)} has a question for you.`);
  const seen = new Set(before.messages.map((m) => m.id));
  const replied = new Set(after.messages.filter((m) => !seen.has(m.id) && m.to === STAKEHOLDER && m.from !== STAKEHOLDER).map((m) => m.from));
  for (const from of replied) out.push(`${said(from)} replied to you.`);
  if (before.phase !== 'proposed' && after.phase === 'proposed') out.push("The CEO's proposal is ready.");
  if (before.phase === 'proposed' && after.phase === 'running') out.push(`${after.name} started. Everyone is hired.`);
  const budgetPaused = (v: CompanyView) => v.pause?.reason === 'budget';
  if (!budgetPaused(before) && budgetPaused(after)) out.push(`${after.name} reached its budget and paused. Raise the budget to carry on.`);
  if (budgetPaused(before) && !budgetPaused(after)) out.push(`${after.name} is working again: the budget was raised.`);
  const resting = (v: CompanyView) => v.pause !== null && v.pause.reason !== 'stakeholder' && v.pause.reason !== 'budget';
  if (!resting(before) && resting(after) && after.pause) {
    out.push(after.pause.until === null ? `${after.name} is resting.` : `${after.name} is resting until ${clock(after.pause.until)}.`);
  }
  if (resting(before) && !resting(after)) out.push(`${after.name} is working again.`);
  return out;
}

/** News from the other companies in the lobby: one that starts to need you more. */
export function lobbyNews(before: LobbyView, after: LobbyView, except: string | null): string[] {
  const out: string[] = [];
  for (const c of after.companies) {
    if (c.id === except) continue;
    const was = before.companies.find((b) => b.id === c.id)?.needsYou ?? 0;
    if (c.needsYou > was) out.push(c.needsYou - was === 1 ? `${c.name}: one more thing needs you.` : `${c.name}: ${countWord(c.needsYou - was)} more things need you.`);
  }
  return out;
}

/** Several sentences said together as one: "A, and B." */
export function oneSentence(sentences: readonly string[]): string {
  const parts = sentences.map(withoutStop).filter(Boolean);
  if (parts.length <= 1) return parts[0] ? `${parts[0]}.` : '';
  const [first, ...rest] = parts;
  const tail = rest.map((p) => (/^(The|A|An) /.test(p) ? lowerFirst(p) : p));
  return `${[first, ...tail.slice(0, -1)].join(', ')}, and ${tail.at(-1) ?? ''}.`;
}
