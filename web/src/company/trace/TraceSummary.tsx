// The line under one of your messages in a conversation (SPEC-v3.md "Steering" 3): how far it got, who acknowledged it
// or disagrees, where it stalls, and "Where it went" for the whole trace. Plain text, never live: the live region says
// only what you did.
import { traceOf } from '../../../../src/core/trace.ts';
import { CompanyLink } from '../people/shared.tsx';
import { summaryLine, type TraceCompany, tracePath } from './traceModel.ts';
import './trace.css';

interface TraceSummaryProps {
  company: TraceCompany;
  companyId: string;
  /** The message it follows: a copy you sent, or the group id a room's copies share. */
  message: string;
  /** The office's clock (useCompanyClock): acknowledgements and deliveries stall by it. */
  now: number;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /** Tells this "Where it went" apart from the others in a thread, for screen readers: "your message from 14:32". */
  about?: string;
}

export function TraceSummary({ company, companyId, message, now, navigate, about }: TraceSummaryProps) {
  const line = summaryLine(company, traceOf(company, message, now), now);
  if (!line) return null;
  return (
    <p className={`trace-line trace-line--${line.tone}`}>
      {line.tone !== 'quiet' && <span className="trace-line__mark" aria-hidden="true" />}
      <span className="trace-line__text">{line.text}</span>
      {line.link && (
        <>
          {' '}
          <CompanyLink companyId={companyId} to={tracePath(message)} navigate={navigate} className="link trace-line__link" focusKey={`trace:${message}`} label={about ? `Where it went: ${about}` : undefined}>
            Where it went
          </CompanyLink>
        </>
      )}
    </p>
  );
}
