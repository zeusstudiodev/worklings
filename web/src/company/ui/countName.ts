// The accessible name of a control that shows a count ("Inbox 4"): the visible text first, then the words, so a person
// who speaks the label ("click Inbox 4") finds it in the name (WCAG 2.5.3) and a screen reader still hears who needs
// what: "Inbox 4, four need you".
import { countWord } from '../../../../src/core/now.ts';

/** The figure the count pill draws. */
export const countFigure = (n: number): string => (n > 99 ? '99+' : String(Math.round(n)));

/** "Inbox 4, four need you in other companies"; just the label when nothing needs anyone. */
export function nameWithCount(label: string, n: number, where = ''): string {
  if (!Number.isFinite(n) || n <= 0) return label;
  return `${label} ${countFigure(n)}, ${countWord(n)} ${n === 1 ? 'needs' : 'need'} you${where}`;
}
