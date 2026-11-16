// Asks raised together (v0.2): one card and one press for the lot. Each question takes its asker's pick and each request the
// office's recommendation, with Undo on the questions as on any answer; what has no pick stays in the inbox. The items stay
// below, each answerable on its own.
import { useId, useRef, useState } from 'react';
import { refusalOf } from '../people/shared.tsx';
import type { CompanyActions } from '../types.ts';
import { type BatchCard as Card, batchResultLine } from './asksModel.ts';

interface Props {
  card: Card;
  actions: Pick<CompanyActions, 'answerBatch'>;
  online: boolean;
  announce: (text: string) => void;
}

export function BatchCard({ card, actions, online, announce }: Props) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pressing = useRef(false);

  const press = async () => {
    if (!online || pressing.current) return;
    pressing.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const done = await actions.answerBatch(card.id);
      announce(batchResultLine(done));
      // The card goes with the answers: focus waits on the heading that counts what needs you.
      document.querySelector<HTMLElement>('[data-needs-count]')?.focus({ preventScroll: true });
    } catch (error) {
      setProblem(`Couldn't answer them together. ${refusalOf(error)}`);
    } finally {
      pressing.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="inbox-batch" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="inbox-batch__title">
        {card.title}
      </h4>
      <ul className="inbox-batch__rows">
        {card.rows.map((row) => (
          <li key={row.key} className="inbox-batch__row">
            <span>{row.what}</span>
            <span className="inbox-batch__does">{row.does}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="button button--primary" aria-disabled={!online || busy || card.answers === 0 || undefined} aria-describedby={`${id}-note`} onClick={() => void press()}>
        {busy ? 'Answering…' : `Answer all with the recommendations`}
      </button>
      <p id={`${id}-note`} className="inbox-batch__note">
        {!online ? 'The office is reconnecting, so this waits.' : card.answers === 0 ? 'None of them has a pick: answer each below.' : 'Each takes the pick marked on it, and a request takes the office’s advice (never “always”). You can answer any of them on its own below instead.'}
      </p>
      {problem && (
        <p className="settings__problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
