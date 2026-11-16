// The checklist's words (SPEC-v0.2.md, "Simple, visible, proven", 3), shared by the progress view and the handover: each
// thing the stakeholder asked for with where it stands, the covering tasks as status words and the final review's
// evidence one press away. Pure, for tests.
import { clip, coarseAge, countWord, plainText } from '../../../../src/core/now.ts';
import { CHECKLIST_PAGE, type ChecklistRow, type ChecklistState, type ChecklistView } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { TASK_TONE, type TaskWord, taskWord } from './progressModel.ts';
import type { StateTone } from '../ui/tone.ts';

/** A state as its row says it. */
export const STATE_WORDS: Readonly<Record<ChecklistState, string>> = { met: 'Met', partly: 'Partly met', 'not-met': 'Not met', unchecked: 'Not checked' };

export interface CheckRow {
  id: string;
  text: string;
  /** Their words, as written; null when no words fit. */
  quote: string | null;
  state: ChecklistState;
  word: string;
  /** The covering tasks in a word each; empty shows "No task covers this yet". */
  tasks: { key: string; title: string; word: TaskWord; tone: StateTone; task: string | null }[];
  /** What the final review saw; null before it marked this item. */
  evidence: {
    note: string;
    /** "Ran npm test: it passed." */
    check: string | null;
    passed: boolean | null;
    files: string[];
    /** A link on the preview while it runs: its address and the path it opens. */
    page: { href: string; path: string } | null;
    /** "Mara, 2 h ago". */
    by: string;
  } | null;
}

/**
 * A path the preview may open: the office's own pattern (CHECKLIST_PAGE), joined to the preview's origin, and only when the
 * link stays on that origin (a verdict stored before the pattern refused `//host/x` would otherwise lead off-site).
 */
function pageLink(preview: string | null, page: string | null): { href: string; path: string } | null {
  if (!preview || !page || !CHECKLIST_PAGE.test(page)) return null;
  try {
    const base = new URL(preview);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    const link = new URL(page, base.origin);
    if (link.origin !== base.origin) return null;
    return { href: link.toString(), path: page };
  } catch {
    // Not an address the browser can read: the page stays words, with no link.
    return null;
  }
}

export function checkRows(view: ChecklistView, o: { now: number; preview: string | null; nameOf: (id: string) => string }): CheckRow[] {
  return view.rows.map((r: ChecklistRow) => {
    const v = r.verdict;
    return {
      id: r.id,
      text: clip(plainText(r.text), 200),
      quote: r.quote ? clip(plainText(r.quote), 400) : null,
      state: r.state,
      word: STATE_WORDS[r.state],
      tasks: r.tasks.map((t) => {
        const word = t.status === 'planned' ? 'Not started' : taskWord({ status: t.status, paused: null });
        return { key: t.planTask, title: clip(plainText(t.title), 120), word, tone: TASK_TONE[word], task: t.task };
      }),
      evidence: v
        ? {
            note: clip(plainText(v.evidence.note), 600),
            check: v.evidence.check ? `Ran ${clip(v.evidence.check.ran, 120)}: it ${v.evidence.check.passed ? 'passed' : 'failed'}.` : null,
            passed: v.evidence.check ? v.evidence.check.passed : null,
            files: v.evidence.files.slice(0, 8).map((f) => clip(f, 160)),
            page: pageLink(o.preview, v.evidence.page),
            by: `${o.nameOf(v.by)}, ${coarseAge(o.now - v.at)}`,
          }
        : null,
    };
  });
}

/** "5 of 6 met, 1 partly met." with the states that have any; before the review, how many there are to check. */
export function countsLine(view: Pick<ChecklistView, 'counts' | 'rows'>): string {
  const c = view.counts;
  const total = view.rows.length;
  if (c.unchecked === total) return `${capital(countWord(total))} ${total === 1 ? 'thing' : 'things'} to check. The final review marks each one met, partly met or not met.`;
  const parts = [`${c.met} of ${total} met`, ...(c.partly > 0 ? [`${c.partly} partly met`] : []), ...(c['not-met'] > 0 ? [`${c['not-met']} not met`] : []), ...(c.unchecked > 0 ? [`${c.unchecked} not checked`] : [])];
  return `${parts.join(', ')}.`;
}
