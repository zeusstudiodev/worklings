// The count of what needs you (docs/design-v3.md, "New components"): highlighter fill, ink tabular figures. Only for
// what needs you, and nothing at zero, so a quiet company shows no badge at all.
import { countFigure } from './countName.ts';

interface CountProps {
  n: number;
  /** What a screen reader hears instead of the figure: ", 3 need you" makes a tab "Inbox, 3 need you". */
  label?: string;
}

export function Count({ n, label }: CountProps) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const figure = countFigure(n);
  if (label === undefined) return <span className="count">{figure}</span>;
  // The words sit outside the pill: a pill is laid out as a block of its own, and a screen reader would hear the gap
  // before it as a pause ("Inbox , 3 need you").
  return (
    <>
      <span className="visually-hidden">{label}</span>
      <span className="count" aria-hidden="true">
        {figure}
      </span>
    </>
  );
}
