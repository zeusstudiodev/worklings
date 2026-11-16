// The leash beside a name (SPEC-v3.md "Steering" 6): "Checks with you" or "Trusted", nothing for Default. An outline
// tag in ink-soft, since yellow means "needs you"; the words carry it, and the tooltip says what it allows.
import type { CompanyView } from '../../../../src/core/company.ts';
import { leashBadge, steeringOf } from './leashModel.ts';
import './leash.css';

export function LeashBadge({ company, person }: { company: Pick<CompanyView, 'steering'>; person: string }) {
  const steering = steeringOf(company, person);
  const badge = leashBadge(steering);
  if (!badge) return null;
  return (
    <span className={`leash-badge leash-badge--${steering.leash}`} title={badge.detail}>
      <span className="visually-hidden">Leash: </span>
      {badge.text}
    </span>
  );
}
