// What you are approving (v0.2): the plan in a few plain sentences above the Approve button, so that approving it is one
// press on something understood: how big the company is, what starts first, how many tasks and what it should cost, and
// how many things you asked for its checklist checks. The office writes the sentences from the plan; this only shows
// them, for the version that waits.
import { countWord } from '../../../../src/core/now.ts';
import type { PlanSummary } from '../../../../src/core/plan-summary.ts';
import { capital } from '../../../../src/core/words.ts';

/** "It checks seven things you asked for." The office's own summary says it once it counts the checklist; then this adds nothing. */
export function checklistCountLine(words: string, items: number): string | null {
  if (items === 0 || /\byou asked for\b/.test(words)) return null;
  return `It checks ${countWord(items)} ${items === 1 ? 'thing' : 'things'} you asked for.`;
}

export function PlanSummaryCard({ summary, id, checklist = 0 }: { summary: PlanSummary; id: string; checklist?: number }) {
  const count = checklistCountLine(summary.words, checklist);
  return (
    <section className="plan-summary" aria-labelledby={`${id}-summary`}>
      <h3 id={`${id}-summary`} className="group-title">
        What you are approving
      </h3>
      <p className="plan-summary__words">
        {summary.words}
        {count && ` ${capital(count)}`}
      </p>
      {summary.estimate && <p className="plan-note">The cost is a rough guide in API-equivalent dollars: real jobs vary a lot, and the Spend dashboard shows what the company really spends.</p>}
    </section>
  );
}
