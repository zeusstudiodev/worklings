// The end card (v0.2): when the company is done, the CEO's final handover to you, clear of everything else in the inbox.
// It leads with the checklist: each thing you asked for and what the final review found, with its evidence one press
// away (what fell short opens by itself). Then the CEO's words (what was built, how to open it, what is not done) and
// what it cost against the estimate, with the preview beside it when the app can be opened. While the CEO has not
// written it, the card says so and does not pretend.
import { useId } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { hourMinute } from '../../lib/format.ts';
import { checkRows, countsLine } from '../progress/checklistModel.ts';
import { ChecklistRows } from '../progress/ChecklistRows.tsx';
import { companyHref, navigate as go } from '../router.ts';
import { handoverOf } from './handoverModel.ts';

export function HandoverCard({ company, companyId, now }: { company: CompanyView; companyId: string; now: number }) {
  const id = useId();
  const handover = handoverOf(company);
  if (!handover) return null;
  const preview = company.preview.state === 'up' || company.preview.state === 'starting';
  const nameOf = (person: string) => company.people.find((p) => p.id === person)?.name ?? 'Someone who left';
  const rows = handover.checklist ? checkRows(handover.checklist, { now, preview: company.preview.state === 'up' ? company.preview.url : null, nameOf }) : [];
  return (
    <section className="handover" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="handover__title">
        {handover.state === 'written' ? 'Done: the final handover' : 'The work is done'}
      </h3>
      {handover.checklist && (
        <div className="handover__checklist" aria-labelledby={`${id}-checklist`} role="group">
          <h4 id={`${id}-checklist`} className="handover__sub">
            What you asked for
          </h4>
          <p className="handover__counts">{countsLine(handover.checklist)}</p>
          <ChecklistRows rows={rows} openShortfalls />
        </div>
      )}
      {handover.state === 'written' ? (
        <>
          {handover.checklist && <h4 className="handover__sub">From the CEO</h4>}
          <p className="handover__by">
            {handover.by ? `From ${handover.by}, the CEO, at ${hourMinute(handover.writtenAt ?? handover.doneAt)}.` : `Written at ${hourMinute(handover.writtenAt ?? handover.doneAt)}.`}
          </p>
          <div className="handover__body">
            {handover.paragraphs.map((p, i) => (
              <p key={`${i}:${p.slice(0, 20)}`}>{p}</p>
            ))}
          </div>
        </>
      ) : (
        <p className="handover__by">Every task and milestone is done. {handover.by ? `${handover.by}, the CEO,` : 'The CEO'} is writing the handover: what was built, how to open it and what is not done.</p>
      )}
      <p className="handover__cost">{handover.cost}</p>
      {preview && (
        <p className="handover__actions">
          <button type="button" className="button button--primary" onClick={() => go(companyHref(companyId, { main: { kind: 'preview' }, panel: null }))}>
            Open the preview
          </button>
        </p>
      )}
    </section>
  );
}
