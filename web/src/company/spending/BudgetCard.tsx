// The Spend dashboard's live part (v0.2): what the company costs an hour right now, and how far the budget has come.
// A meter never says its state by colour alone: the words say it, and a company that has reached its budget says it is paused.
import { useId } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { dollars, percent, rate } from '../../lib/format.ts';
import { Stat } from '../dashboards/charts.tsx';
import { budgetFigure, capWords } from './spendingModel.ts';
import './spending.css';

export function BudgetCard({ company }: { company: CompanyView }) {
  const id = useId();
  const spending = company.spending;
  if (!spending) return null;
  const { live, budget } = spending;
  const figure = budgetFigure(budget);
  const names = new Map(company.people.map((p) => [p.id, p.name || p.title]));
  const near = budget.person === null ? [] : budget.people.filter((p) => p.state !== 'ok');
  return (
    <section className="board-section db-card db-c12" aria-labelledby={`${id}-live`}>
      <h4 id={`${id}-live`} className="board-section__title">
        Cost now and the budget
      </h4>
      <div className="board-stats">
        <Stat value={rate(live.perHour)} title="Cost an hour now" note={live.perHour > 0 ? `Over the last ${live.windowMinutes} min of work.` : 'Nothing has finished a step yet.'} />
        {figure && (
          <Stat value={figure.text} title="Company budget" note={figure.words} needs={figure.state !== 'ok'} />
        )}
      </div>
      {figure ? (
        <div className={`spend-meter spend-meter--${figure.state}`}>
          <div className="spend-meter__track" aria-hidden="true">
            <div className="spend-meter__fill" style={{ width: `${Math.round(figure.share * 100)}%` }} />
          </div>
          <p className="spend-meter__words">
            {percent(budget.share ?? 0)} of {capWords(budget.company ?? 0)} spent.
            {figure.state === 'warning' && ' Near the limit: the office has asked you in the inbox.'}
            {figure.state === 'paused' && ' Work is paused until you raise the budget.'}
          </p>
        </div>
      ) : (
        <p className="spend-meter__words">No company budget. Set one in Settings to have the office ask at 80% and pause at the limit.</p>
      )}
      {budget.person !== null && (
        <>
          <p className="spend-meter__words">
            Each person has {capWords(budget.person)}. {near.length === 0 ? 'Nobody is near it.' : `${near.length === 1 ? 'One person is' : `${near.length} people are`} near or over it:`}
          </p>
          {near.length > 0 && (
            <ul className="spend-meter__sub">
              {near.map((p) => (
                <li key={p.person}>
                  {names.get(p.person) ?? p.person}: {dollars(p.spent)} ({percent(p.share)}){p.state === 'paused' ? ', paused' : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
