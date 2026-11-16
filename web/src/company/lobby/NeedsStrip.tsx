// What needs you across every company (SPEC-v0.2.md, "Simple, visible, proven", 1): one strip above the lobby's cards,
// oldest first, each item opening the right company at the right place: the inbox on its question, the proposal, the
// plan, or progress where work has stopped. Gone when nothing waits.
import { type MouseEvent, useId, useState } from 'react';
import type { LobbyCompany } from '../../../../src/core/company.ts';
import { coarseAge } from '../../../../src/core/now.ts';
import { needsAcross } from '../../../../src/core/overview.ts';
import { companyHref, navigate } from '../router.ts';
import { Count } from '../ui/Count.tsx';
import { needsLine, needsStrip, routeOf } from './lobbyModel.ts';

interface NeedsStripProps {
  companies: readonly LobbyCompany[];
  /** Each company's name as the lobby tells it apart, by id. */
  names: ReadonlyMap<string, string>;
  now: number;
}

export function NeedsStrip({ companies, names, now }: NeedsStripProps) {
  const id = useId();
  const [all, setAll] = useState(false);
  const items = needsAcross(companies);
  if (items.length === 0) return null;
  const { total, shown, toggle } = needsStrip(items, all);
  const follow = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <section className="needs-strip" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="needs-strip__title">
        Needs you
        <Count n={total} label={`, ${total} in all`} />
      </h3>
      <ul className="needs-strip__list">
        {shown.map((item, i) => {
          const href = companyHref(item.company, routeOf(item.target));
          const company = names.get(item.company) ?? companies.find((c) => c.id === item.company)?.name ?? 'A company';
          return (
            <li key={`${item.company}:${i}:${item.at}`} className={`needs-strip__item${item.kind === 'stuck' ? ' needs-strip__item--stuck' : ''}`}>
              <a className="needs-strip__link" href={href} onClick={follow(href)}>
                <span className="needs-strip__company">{company}: </span>
                <span className="needs-strip__text">{needsLine(item)}</span>
              </a>
              <span className="needs-strip__age">{coarseAge(now - item.at)}</span>
            </li>
          );
        })}
      </ul>
      {toggle && (
        <button type="button" className="link needs-strip__toggle" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {toggle}
        </button>
      )}
    </section>
  );
}
