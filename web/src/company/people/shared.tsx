// Pieces the work tabs share (Now, Inbox, People, a person, Tasks): links that are real addresses, text that clamps
// with "Read all of it", Copy, and the row a person gets on Now and People.
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { companyPath } from '../router.ts';
import { StatePill } from '../ui/StatePill.tsx';
import type { Tone } from './peopleModel.ts';
import './people.css';

type Navigate = (path: string, options?: { replace?: boolean }) => void;

interface CompanyLinkProps {
  companyId: string;
  /** The address under the company: "people/kai", "tasks/t-12/diff". */
  to: string;
  navigate: Navigate;
  className?: string;
  children: ReactNode;
  /** Kept on the link so Back can put focus on it again (router.ts). */
  focusKey?: string;
  label?: string;
  describedBy?: string;
}

/**
 * A link to a view in the company: a real address, so it opens in a new tab or window as links do, and a plain click
 * goes there in place.
 */
export function CompanyLink({ companyId, to, navigate, className, children, focusKey, label, describedBy }: CompanyLinkProps) {
  const follow = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={companyPath(companyId, to)} className={className} data-focus={focusKey} aria-label={label} aria-describedby={describedBy} onClick={follow}>
      {children}
    </a>
  );
}

/**
 * Text that shows `lines` lines, then "Read all of it", which opens the rest in place; focus moves onto the text rather
 * than dropping to the page when the button goes. Only text that is really cut gets the button.
 */
export function Clamp({ text, lines, className = '' }: { text: string; lines: number; className?: string }) {
  const body = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = body.current;
    if (!el || open || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setCut(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, text]);
  return (
    <>
      <p ref={body} className={`clamp${open ? ' is-open' : ''} ${className}`.trim()} style={{ '--lines': lines } as CSSProperties} tabIndex={open ? -1 : undefined}>
        {text}
      </p>
      {cut && !open && (
        <button
          type="button"
          className="link clamp__more"
          onClick={() => {
            flushSync(() => setOpen(true));
            body.current?.focus({ preventScroll: true });
          }}
        >
          Read all of it
        </button>
      )}
    </>
  );
}

/** Copies a command or a path; the live region says it worked, since the button's own word changes only for the eye. */
export function CopyButton({ text, what, announce }: { text: string; what: string; announce: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  const copy = () => {
    const failed = () => announce(`Couldn't copy ${what}. Select it and copy it yourself.`);
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      announce('Copied.');
    }, failed);
  };
  return (
    <button type="button" className="link copy" aria-label={`Copy ${what}`} onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

interface WorkRowProps {
  hue: string;
  /** The person's name: a link to their panel. Null for a row that opens nothing (a visitor). */
  name: ReactNode;
  title?: string;
  cost: string;
  word?: { text: string; tone: Tone } | null;
  /** Beside the state: their leash ("Checks with you"), where it isn't the default. */
  badge?: ReactNode;
  lines: ReactNode;
  /** Buttons and links that sit above the row's stretched link: Answer, a task. */
  extra?: ReactNode;
  depth?: number;
}

/**
 * A person as Now and People list them: their room's marker, the name (a link stretched over the whole row, so the row
 * is what you click and the name what a screen reader hears), the cost, then the lines.
 */
export function WorkRow({ hue, name, title, cost, word, badge, lines, extra, depth }: WorkRowProps) {
  const pill = word && <StatePill label={word.text} tone={word.tone} />;
  return (
    <div className="work-row" style={{ '--hue': hue, ...(depth !== undefined ? { '--depth': depth } : {}) } as CSSProperties}>
      <span className="work-row__marker" aria-hidden="true" />
      <div className="work-row__main">
        <div className="work-row__head">
          <span className="work-row__name">{name}</span>
          <span className="work-row__cost">{cost}</span>
        </div>
        {title && <p className="work-row__title">{title}</p>}
        {badge ? (
          <div className="work-row__pills">
            {pill}
            {badge}
          </div>
        ) : (
          pill
        )}
        {lines}
        {extra && <div className="work-row__extra">{extra}</div>}
      </div>
    </div>
  );
}

/** The error message an action was refused with, as the office said it. */
export function refusalOf(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : "The office didn't answer.";
}
