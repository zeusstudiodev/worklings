// What changed between two versions of the plan, in words (planModel.ts, diffView): added, cut, changed and moved, each
// a sentence, with a change's fields as "was" and "now". The words carry it; the rule on the left only backs them up.
import { useId } from 'react';
import type { DiffView } from './planModel.ts';

export function PlanDiffView({ diff }: { diff: DiffView }) {
  const id = useId();
  if (diff.sections.length === 0 && !diff.goal) return <p className="plan-diff__summary">Nothing changed.</p>;
  return (
    <div className="plan-diff">
      <p className="plan-diff__summary">{diff.summary}</p>
      {diff.goal && (
        <section className="plan-diff__section plan-diff__section--changed" aria-labelledby={`${id}-goal`}>
          <h3 id={`${id}-goal`} className="plan-diff__title">
            The goal
          </h3>
          <dl className="plan-diff__parts">
            <dt className="visually-hidden">The goal</dt>
            <dd>
              <span className="plan-diff__was">Was</span> {diff.goal.before}
            </dd>
            <dd>
              <span className="plan-diff__now">Now</span> {diff.goal.after}
            </dd>
          </dl>
        </section>
      )}
      {diff.sections.map((s) => (
        <section key={s.kind} className={`plan-diff__section plan-diff__section--${s.kind}`} aria-labelledby={`${id}-${s.kind}`}>
          <h3 id={`${id}-${s.kind}`} className="plan-diff__title">
            {s.title} <span className="tabular">({s.items.length})</span>
          </h3>
          <ul className="plan-diff__items">
            {s.items.map((item) => (
              <li key={item.key} className="plan-diff__item">
                <p className="plan-diff__text">{item.text}</p>
                {item.parts.length > 0 && (
                  <dl className="plan-diff__parts">
                    {item.parts.map((p) =>
                      p.long ? (
                        <div key={p.label} className="plan-diff__part">
                          <dt>{p.label}</dt>
                          <dd>
                            <details className="plan-diff__long">
                              <summary>Show both</summary>
                              <p>
                                <span className="plan-diff__was">Was</span> {p.before || 'empty'}
                              </p>
                              <p>
                                <span className="plan-diff__now">Now</span> {p.after || 'empty'}
                              </p>
                            </details>
                          </dd>
                        </div>
                      ) : (
                        <div key={p.label} className="plan-diff__part">
                          <dt>{p.label}</dt>
                          <dd>
                            <span className="plan-diff__was">Was</span> {p.before || 'empty'}
                          </dd>
                          <dd>
                            <span className="plan-diff__now">Now</span> {p.after || 'empty'}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
