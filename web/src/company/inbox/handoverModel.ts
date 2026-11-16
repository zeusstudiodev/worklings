// The end of a company's work (v0.2): once every task and milestone is done and the final review has passed, the CEO
// writes the final handover to the stakeholder: what was built, how to open it, what is not done and what it cost. The view
// has no field for it, so it is the CEO's newest report with no task, written after the plan finished, or in the turn of
// the end check that finished it (sameTurnHandoverSince, the window the company itself reads). The handover leads
// with the checklist the final review marked (SPEC-v0.2.md, "Simple, visible, proven", 3). Pure, for tests.
import type { CompanyView } from '../../../../src/core/company.ts';
import type { ChecklistView } from '../../../../src/core/steering.ts';
import { clip, plainText } from '../../../../src/core/now.ts';
import { sameTurnHandoverSince } from '../../../../src/core/overview.ts';
import { dollars } from '../../lib/format.ts';
import { rangeWords } from '../spending/spendingModel.ts';

export interface Handover {
  /** 'waiting': the plan is finished and the CEO hasn't written the handover yet. */
  state: 'waiting' | 'written';
  /** When the plan finished, and when the handover was written. */
  doneAt: number;
  writtenAt: number | null;
  /** The CEO's words, paragraph by paragraph; empty while it is waiting. */
  paragraphs: string[];
  /** "$4.20 so far, against an estimate of $3.10 to $9.40." */
  cost: string;
  /** The CEO's name for the card's byline; null when the company has no CEO. */
  by: string | null;
  /** What you asked for and what the final review found, first on the card; null for a plan without a checklist. */
  checklist: ChecklistView | null;
}

export function handoverOf(company: Pick<CompanyView, 'done' | 'reports' | 'people' | 'spending' | 'settings' | 'checklist' | 'tasks'>): Handover | null {
  const done = company.done ?? null;
  if (done === null) return null;
  const ceo = company.people.find((p) => p.level === 'ceo');
  // The end check's handover comes in its own turn, before the office marks the plan done a moment later.
  const from = Math.min(done, sameTurnHandoverSince(company.tasks) ?? done);
  const report = [...company.reports].filter((r) => r.person === ceo?.id && r.taskId === null && r.outcome === 'done' && r.at >= from).sort((a, b) => b.at - a.at)[0];
  const spent = company.spending?.budget.spent ?? 0;
  const job = company.spending?.job;
  const plan = company.settings.billing === 'plan';
  const cost = `${dollars(spent)} so far${plan ? ' (API-equivalent, not a bill)' : ''}${job ? `, against an estimate of ${rangeWords(job.low, job.high)}` : ', with no estimate made'}.`;
  const text = report ? plainText(report.text).trim() : '';
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => clip(p.replace(/\s*\n\s*/g, ' ').trim(), 1_200))
    .filter(Boolean)
    .slice(0, 12);
  const checklist = company.checklist && company.checklist.rows.length > 0 ? company.checklist : null;
  return { state: report && paragraphs.length > 0 ? 'written' : 'waiting', doneAt: done, writtenAt: report?.at ?? null, paragraphs, cost, by: ceo ? ceo.name : null, checklist };
}
