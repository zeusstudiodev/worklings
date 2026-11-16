// What an ask says besides its question (v0.2): the office's recommendation on a request for approval, what happens when
// nobody answers a question, the answer the office gave by default, and the asks raised together that one press answers.
// Pure, for the inbox, the feed and tests.
import type { Approval, CompanyView, InboxBatch, Question } from '../../../../src/core/company.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute } from '../../lib/format.ts';
import { askerCalled, type Item } from './inboxModel.ts';

const stop = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** What the asker does when nobody answers, in the sentence it gave: " Kai then: carries on with the simplest version." */
const thenClause = (who: string, fallback: string | null | undefined): string => {
  const text = fallback ? plainText(fallback).trim() : '';
  return text ? ` ${capital(who)} then: ${stop(clip(text, 200))}` : '';
};

/**
 * What happens when nobody answers a question, or null when the question says nothing about it (the office's own, and
 * older ones). A safe one takes its asker's pick by itself; any other counts as a no and the asker carries on.
 */
export function ifNoAnswer(company: CompanyView, q: Question): string | null {
  if (q.answer) return null;
  const who = askerCalled(company, { kind: 'question', question: q });
  const when = q.defaultAt ? hourMinute(q.defaultAt) : null;
  if (q.safe === true && when) {
    const pick = q.recommended !== null ? q.options[q.recommended] : undefined;
    return pick ? `If you don't answer, ${who} takes the pick, “${clip(plainText(pick), 80)}”, at ${when}.` : `If you don't answer by ${when}, ${who} carries on with their own judgment.`;
  }
  if (when) return `No answer by ${when} counts as a no.${thenClause(who, q.fallback)}`.trim();
  return q.fallback ? `If you don't answer,${thenClause(who, q.fallback).replace(/^ .*? then:/, '')}`.trim() : null;
}

export interface AdviceLines {
  /** "We suggest allowing it once." / "We suggest saying no." */
  recommend: string;
  why: string;
  /** "If you don't answer it is a no, and Kai then …" */
  ifNoAnswer: string;
}

/** The office's recommendation on a request for approval, or null for one that has none (from before 0.2). */
export function adviceLines(company: CompanyView, a: Approval): AdviceLines | null {
  const advice = a.advice;
  if (!advice) return null;
  const who = askerCalled(company, { kind: 'approval', approval: a });
  return {
    recommend: advice.recommend === 'allow' ? 'The office suggests allowing it once.' : 'The office suggests saying no.',
    why: stop(clip(plainText(advice.why), 240)),
    ifNoAnswer: `If you don't answer, it is a no.${thenClause(who, advice.fallback)}`,
  };
}

/** The line for an answer the office gave because nobody did: "No answer by 14:32, so Kai took the pick: “Cards”." */
export function byDefaultLine(company: CompanyView, q: Question): string | null {
  const answer = q.answer;
  if (!answer?.byDefault) return null;
  const who = askerCalled(company, { kind: 'question', question: q });
  const pick = answer.option !== null ? q.options[answer.option] : undefined;
  return `You didn't answer, so ${who} took the pick${pick ? `, “${clip(plainText(pick), 80)}”` : ''}, at ${hourMinute(answer.at)}.`;
}

export interface BatchRow {
  key: string;
  /** "Which payment should the app take?" or "Allow: push the work branch". */
  what: string;
  /** What the press does for it: "Answers “TWINT”.", "Allows it once.", "Says no.", or that it stays for you. */
  does: string;
  stays: boolean;
}

export interface BatchCard {
  id: string;
  rows: BatchRow[];
  /** How many a press answers (the rest have no pick and stay in the inbox). */
  answers: number;
  /** "Mina asks 3 things together." */
  title: string;
}

/** The asks raised together that are still open, for the one card; batches of one stay as they are. */
export function batchCards(company: CompanyView): BatchCard[] {
  const batches: InboxBatch[] = company.batches ?? [];
  const out: BatchCard[] = [];
  for (const batch of batches) {
    if (batch.items.length < 2) continue;
    const rows: BatchRow[] = [];
    for (const ref of batch.items) {
      if (ref.kind === 'question') {
        const q = company.questions.find((x) => x.id === ref.id);
        if (!q) continue;
        const pick = q.recommended !== null ? q.options[q.recommended] : undefined;
        rows.push({ key: q.id, what: clip(plainText(q.text), 120), does: pick ? `Answers “${clip(plainText(pick), 60)}”.` : 'No pick, so it stays for you.', stays: !pick });
      } else {
        const a = company.approvals.find((x) => x.id === ref.id);
        if (!a) continue;
        const allow = a.advice?.recommend === 'allow';
        rows.push({ key: a.id, what: clip(stop(plainText(a.summary)).replace(/\.$/, ''), 120), does: allow ? 'Allows it once.' : 'Says no.', stays: false });
      }
    }
    if (rows.length < 2) continue;
    out.push({ id: batch.id, rows, answers: rows.filter((r) => !r.stays).length, title: `${capital(countWord(rows.length))} asks raised together.` });
  }
  return out;
}

/** What the press said: "Answered 2 with the recommendations. Undo stays a few seconds on each. One has no pick and waits for you." */
export function batchResultLine(result: { answered: number; left: number }): string {
  const answered = `Answered ${result.answered} with the recommendations. Undo stays a few seconds on each.`;
  return result.left > 0 ? `${answered} ${result.left === 1 ? 'One has no pick and waits' : `${result.left} have no pick and wait`} for you.` : answered;
}

export type { Item };
