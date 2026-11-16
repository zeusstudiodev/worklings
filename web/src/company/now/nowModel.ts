// Now in a company (docs/design-v3.md, "Now, rest and desks", and the state table under "The top bar"): the headline
// from the inbox or the company's state, then who is at work on what, and the groups. Pure, so it can be tested.
import type { CompanyView, PersonView } from '../../../../src/core/company.ts';
import { coarseAge, countWord } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';
import { waitsForWords } from '../pauseWords.ts';
import { spendWithBudget } from '../spending/spendingModel.ts';
import { planWait } from '../plan/planModel.ts';
import { inLine, isAtWork, nameOf, openItems, shown, taskOf, waitPerson, type Work, workOf } from '../people/peopleModel.ts';

/** Someone who reported done stays in Done this long. */
export const DONE_FOR_MS = 15 * 60_000;
/** Waiting for a desk shows this many, then a count. */
export const DESK_ROWS = 5;

// ---------------------------------------------------------------------------------------------------------------
// The headline

/**
 * The inbox's sentence: "Kai needs your OK to push the work branch to GitHub.", "The CEO has a question for you.",
 * "Three things need you."; null when nothing does. `named` is the one person it names, if it names one.
 */
export function inboxSentence(company: CompanyView, now: number): { text: string; named: string | null } | null {
  const items = openItems(company, now);
  const proposal = company.phase === 'proposed' && company.proposal !== null ? 1 : 0;
  const plan = planWait(company);
  const n = items.length + proposal + (plan ? 1 : 0);
  if (n === 0) return null;
  if (n > 1) return { text: `${capital(countWord(n))} things need you.`, named: null };
  const [only] = items;
  if (!only) return { text: plan ? plan.sentence : "The CEO's proposal is ready for you.", named: null };
  const who = nameOf(company, waitPerson(only));
  if (only.kind === 'approval') return { text: `${capital(who.called)} needs your OK to ${inLine(only.approval.summary)}.`, named: waitPerson(only) };
  return { text: `${capital(who.called)} has a question for you.`, named: waitPerson(only) };
}

/** "Last report 25 min ago from Kai.", left out when the inbox's sentence already named them. */
export function lastReportSentence(company: CompanyView, now: number, named: string | null): string | null {
  const latest = company.reports.reduce<CompanyView['reports'][number] | null>((best, r) => (!best || r.at > best.at ? r : best), null);
  if (!latest || latest.person === named) return null;
  return `Last report ${coarseAge(now - latest.at)} from ${nameOf(company, latest.person).called}.`;
}

export interface Headline {
  /** What needs you, followed by "Open the inbox". */
  needs: string | null;
  /** The company's state (the lobby row's sentence), and while people work, the latest report. */
  rest: string[];
}

/**
 * `text` without one of its sentences, as the state joins them: whole sentences with a space between. The sentence may
 * hold a full stop of its own (a quoted milestone title), so it is matched whole, never split.
 */
function withoutSentence(text: string, sentence: string): string {
  if (text === sentence) return '';
  if (text.startsWith(`${sentence} `)) return text.slice(sentence.length + 1);
  if (text.endsWith(` ${sentence}`)) return text.slice(0, -sentence.length - 1);
  return text.replace(` ${sentence} `, ' ');
}

/**
 * The headline: the inbox's sentence, then the company's state as the top bar and the lobby say it (`state`, from the
 * shell's model, so they agree), then while anyone works the latest report, as v2's headline ends. The state names a
 * waiting plan too (the bar and the lobby have no inbox sentence above it); here the inbox's sentence already said it.
 */
export function headline(company: CompanyView, now: number, state: string): Headline {
  const needs = inboxSentence(company, now);
  const said = needs ? withoutSentence(state, needs.text) : state;
  const rest = said ? [said] : [];
  const working = company.phase === 'running' && company.pause === null && company.problem === null && company.desks.working > 0;
  const report = working ? lastReportSentence(company, now, needs?.named ?? null) : null;
  return { needs: needs?.text ?? null, rest: report ? [...rest, report] : rest };
}

/** Phones add the spend under the headline: "$4.20 spent, API-equivalent." */
export function spendLine(company: CompanyView): string {
  const total = company.people.reduce((s, p) => s + p.cost, 0);
  return spendWithBudget(total, company.spending?.budget, company.settings.billing === 'plan');
}

// ---------------------------------------------------------------------------------------------------------------
// The groups

export interface NowRow {
  person: PersonView;
  work: Work;
  /** The row leads with this: the status line, or "On it: Build the streak card." before the first one. */
  lead: string;
  /** Their task, under the lead, unless the lead already says it. */
  task: { id: string; title: string } | null;
}

export interface NowGroups {
  waiting: NowRow[];
  stuck: NowRow[];
  working: NowRow[];
  desks: { rows: NowRow[]; more: number; reason: string | null };
  done: NowRow[];
  others: NowRow[];
}

/** Why people wait for a desk: the company's cap, the hub's, or a rest. */
export function deskReason(company: CompanyView): string {
  if (company.pause) return company.pause.until !== null ? `Nothing starts until the company wakes at ${hourMinute(company.pause.until)}.` : `Nothing starts until ${waitsForWords(company.pause)}.`;
  if (company.desks.working >= company.desks.max) return `The company is using its ${countWord(company.desks.max)} ${company.desks.max === 1 ? 'desk' : 'desks'}.`;
  return "The hub's desks are all in use by other companies.";
}

export function nowGroups(company: CompanyView, now: number): NowGroups {
  const rows = company.people.map((person): NowRow & { recent: number; reportDone: number | null } => {
    const work = workOf(company, person, now);
    const task = taskOf(company, person.task);
    const lead = work.line;
    const latest = company.reports.reduce<number | null>((best, r) => (r.person === person.id && r.outcome === 'done' && (best === null || r.at > best) ? r.at : best), null);
    return {
      person,
      work,
      lead,
      task: task && !lead.startsWith('On it:') && task.status !== 'done' && task.status !== 'dropped' ? { id: task.id, title: shown(task.title, 160) } : null,
      recent: Math.max(person.status?.at ?? 0, person.desk.since),
      reportDone: latest,
    };
  });
  // Each person lands in the first group that takes them.
  const used = new Set<string>();
  const take = (test: (r: (typeof rows)[number]) => boolean) => {
    const out = rows.filter((r) => !used.has(r.person.id) && test(r));
    for (const r of out) used.add(r.person.id);
    return out;
  };
  const strip = ({ person, work, lead, task }: (typeof rows)[number]): NowRow => ({ person, work, lead, task });
  const waiting = take((r) => r.work.kind === 'needs-ok' || r.work.kind === 'needs-answer').sort((a, b) => a.work.since - b.work.since);
  const stuck = take((r) => r.work.kind === 'stuck').sort((a, b) => a.work.since - b.work.since);
  const working = take((r) => isAtWork(r.work)).sort((a, b) => b.recent - a.recent);
  const desks = take((r) => r.work.kind === 'waiting').sort((a, b) => (a.person.desk.queue ?? 99) - (b.person.desk.queue ?? 99) || a.work.since - b.work.since);
  const done = take((r) => r.reportDone !== null && now - r.reportDone <= DONE_FOR_MS).sort((a, b) => (b.reportDone ?? 0) - (a.reportDone ?? 0));
  const others = take(() => true).sort((a, b) => b.recent - a.recent);
  return {
    waiting: waiting.map(strip),
    stuck: stuck.map(strip),
    working: working.map(strip),
    desks: { rows: desks.slice(0, DESK_ROWS).map(strip), more: Math.max(0, desks.length - DESK_ROWS), reason: desks.length > 0 ? deskReason(company) : null },
    done: done.map(strip),
    others: others.map(strip),
  };
}

/** "and 9 more" under Waiting for a desk. */
export const moreLine = (n: number): string => `and ${n} more`;

/** The CEO, whom "Message the CEO" opens. */
export const ceoOf = (company: Pick<CompanyView, 'people'>): PersonView | undefined => company.people.find((p) => p.level === 'ceo');
