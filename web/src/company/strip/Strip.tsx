// The live strip (docs/design-v3.md, "The live strip"; design-hud, "The live strip"): the feed's newest lines as
// bubbles over the model, riding on the talk bar. One button, "Open the feed", that opens the feed at the line pressed;
// nothing in it is live. A line stays only a moment (a short anti-flicker), and a newer one shows at once; after five quiet minutes
// the lines fade (not on phones, where its one line always stays, with Feed's count at its end).
import { type MouseEvent, useEffect, useId, useMemo, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { type FeedLine, facesOf, NOTHING_SAID } from '../feed/feedModel.ts';
import { faceOfId, Glyph, Paper } from '../talk/bits.tsx';
import { Face } from '../ui/Face.tsx';
import { ageOf, heldLines, isQuiet, stripLines, stripName } from './stripModel.ts';
import './strip.css';

interface Props {
  snapshot: Pick<Snapshot, 'studio'>;
  company: CompanyView;
  /** Every line, bursts folded or not: the strip folds them itself. */
  lines: readonly FeedLine[];
  /** Three on the office, one on a board or a phone. */
  count: number;
  phone: boolean;
  now: number;
  /** New replies to you and disagreements: the button's name, and on phones its count at the end. */
  replies: number;
  feedId: string;
  onOpen: (at: string | null) => void;
}

export function Strip({ snapshot, company, lines, count, phone, now, replies, feedId, onOpen }: Props) {
  const id = useId();
  const newest = useMemo(() => stripLines(lines, count), [lines, count]);
  // The lines there when the strip mounts were not just put up, so they owe no second: the first line that happens after
  // them shows at once (`at: 0`), not after what is left of a second counted from the mount.
  const [shown, setShown] = useState<{ lines: readonly FeedLine[]; at: number }>(() => ({ lines: newest, at: 0 }));
  // Each line stays at least a second; lines that come faster are skipped for the newest when it is up. The same lines
  // in a new array change nothing.
  useEffect(() => {
    const held = heldLines(shown.lines, shown.at, newest, Date.now());
    if (held.lines === shown.lines && held.wait === null) return;
    const delay = held.wait === null ? 0 : Math.max(0, held.wait - Date.now());
    const timer = window.setTimeout(() => setShown({ lines: newest, at: Date.now() }), delay);
    return () => window.clearTimeout(timer);
  }, [newest, shown]);

  const quiet = !phone && isQuiet(shown.lines, now);
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    const line = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-line]') : null;
    onOpen(line?.dataset.line ?? null);
  };

  if (shown.lines.length === 0 && !phone) return null;
  return (
    <>
      {/* The name holds the words on screen (2.5.3), after what the key does: the hint, then the button's own content. */}
      <span id={`${id}-do`} hidden>
        {stripName(replies)}
      </span>
      <button id={`${id}-key`} type="button" className={`livestrip${quiet ? ' is-quiet' : ''}${phone ? ' livestrip--phone' : ''}`} aria-expanded={false} aria-controls={feedId} aria-labelledby={`${id}-do ${id}-key`} onClick={press}>
      {shown.lines.length === 0 ? (
        <span className="livestrip__line livestrip__line--empty">{NOTHING_SAID}</span>
      ) : (
        shown.lines.map((l) => <Line key={l.id} line={l} snapshot={snapshot} company={company} now={now} />)
      )}
      {phone && replies > 0 && (
        <span className="livestrip__count" aria-hidden="true">
          {replies}
        </span>
      )}
      </button>
    </>
  );
}

function Line({ line, snapshot, company, now }: { line: FeedLine; snapshot: Pick<Snapshot, 'studio'>; company: CompanyView; now: number }) {
  const faces = facesOf(line);
  const tone = line.tone === 'needs' ? ' livestrip__line--needs' : line.tone === 'stuck' ? ' livestrip__line--stuck' : '';
  return (
    <span className={`livestrip__line${tone}`} data-line={line.id}>
      <span className="livestrip__who" aria-hidden="true">
        {faces.length === 2 && line.kind !== 'burst' ? (
          <>
            <Face of={faceOfId(snapshot, company, faces[0] ?? '')} size={24} />
            <Glyph name="relay" size={14} className="livestrip__hop" />
            <Face of={faceOfId(snapshot, company, faces[1] ?? '')} size={24} />
          </>
        ) : (
          <span className="livestrip__faces">
            {faces.map((id, i) => (
              <Face key={`${id}:${i}`} of={faceOfId(snapshot, company, id)} size={24} />
            ))}
          </span>
        )}
      </span>
      {line.kind === 'passed' && <Paper />}
      {line.kind === 'stall' && <Glyph name="stall" size={14} className="livestrip__mark" />}
      {line.kind === 'report' && <Glyph name="check" size={14} className="livestrip__mark" />}
      <span className="livestrip__words">
        {line.lead && <b>{line.lead} </b>}
        {line.words}
      </span>
      <span className="livestrip__age">{ageOf(now - line.at)}</span>
    </span>
  );
}
