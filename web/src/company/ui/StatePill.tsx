// A state in a word or two: the company's in the top bar, a person's on their panel, a task's on its page. The words
// carry the state; the tone only backs them up, so colour is never the only sign.

import type { StateTone } from './tone.ts';

export type { StateTone };

/** `detail`, the state's full sentence, is what screen readers hear and what the tooltip says; the pill shows `label`. */
export function StatePill({ label, tone, detail }: { label: string; tone: StateTone; detail?: string }) {
  return (
    <span className={`state-pill state-pill--${tone}`} title={detail}>
      {tone !== 'neutral' && tone !== 'needs' && <span className="state-pill__mark" aria-hidden="true" />}
      <span className="state-pill__label" aria-hidden={detail ? true : undefined}>
        {label}
      </span>
      {detail && <span className="visually-hidden">{detail}</span>}
    </span>
  );
}
