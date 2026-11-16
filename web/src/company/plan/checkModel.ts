// What a task's check says (v0.2): the command the plan gave it and what came of it when the office ran it as the task was
// reported done. Pure, for the plan, the task page and the board's cards.
import type { PersonView, Task, TaskCheck } from '../../../../src/core/company.ts';
import { clip, plainText } from '../../../../src/core/now.ts';

export type CheckState = TaskCheck['state'];

export interface CheckWords {
  state: CheckState;
  /** The short tag: "Check passed". */
  tag: string;
  /** The sentence: "The check failed on its 2nd run and the task went back to Sam." */
  sentence: string;
  command: string;
  /** What the check printed at the end, cleaned; empty when it printed nothing. */
  tail: string;
}

const ORDINAL = ['', '1st', '2nd', '3rd'];
const run = (n: number): string => ORDINAL[n] || `${n}th`;

export function checkWords(task: Pick<Task, 'check'>, owner: Pick<PersonView, 'name' | 'title'> | undefined): CheckWords | null {
  const c = task.check;
  if (!c) return null;
  const who = owner ? (owner.name && owner.name !== owner.title ? owner.name : `the ${owner.title.toLowerCase()}`) : 'its owner';
  const tail = clip(plainText(c.tail).trim(), 600);
  const base = { state: c.state, command: clip(plainText(c.command), 200), tail };
  switch (c.state) {
    case 'pending':
      return { ...base, tag: 'Check not run', sentence: 'The office runs the check when the task is reported done.' };
    case 'running':
      return { ...base, tag: 'Check running', sentence: 'The office is running the check now.' };
    case 'passed':
      return { ...base, tag: 'Check passed', sentence: c.runs > 1 ? `The check passed on its ${run(c.runs)} run, after the task went back to ${who}.` : 'The check passed.' };
    case 'failed':
      return { ...base, tag: 'Check failed', sentence: `The check failed on its ${run(c.runs)} run, so the task went back to ${who}.` };
    case 'unrunnable':
      return { ...base, tag: 'Needs a person', sentence: "The office wouldn't run the check (it would have asked for your OK, or couldn't start), so a person reviews the task instead." };
    default:
      return null;
  }
}
