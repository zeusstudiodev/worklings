// A sticky note on the task board (docs/design-hud.md, "The task board"): a task in its owner's room colour, its title a
// link to the task that stretches over the whole note (its press target), and Move and its one key outside the link. The
// owner, the line, the milestone and the place in line are the link's description, so ticking minutes never change its
// name. The note is drawn the same wherever it lies: a column, a lane, the phone's column, a drop form's place.
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { Face, type FaceMark, type FaceOf } from '../../ui/Face.tsx';
import { Glyph } from './Glyph.tsx';

/** What a note shows, worked out by the board from the columns model's words. */
export interface NoteView {
  /** The task's id, or "plan". */
  id: string;
  /** The owner's room style, for its paper ("design"); null for none. */
  hue: string | null;
  tone: 'room' | 'you' | 'done' | 'cancelled';
  band: string;
  place: string | null;
  /** New, or moved column or owner, since you last left the board. */
  changed: boolean;
  title: string;
  href: string;
  kind?: string | null;
  check?: { tag: string; state: string } | null;
  part: string | null;
  parts: { done: number; total: number; line: string } | null;
  line: string;
  stuck: string | null;
  owner: { name: string; face: FaceOf; mark: FaceMark | null; needsYou: boolean };
  milestone: string | null;
  description: string;
}

export interface NoteProps {
  view: NoteView;
  /** The roving key its link answers to, as `data-tb-key`. */
  itemKey?: string;
  /** The link's place in the tab order: the board's one tab stop is 0, every other card -1. */
  linkTab?: 0 | -1;
  /** Move, on the band; on phones, in the foot as a 44 px key. */
  move?: ReactNode;
  /** The note's one key: Answer, Resume, Undo the cancel, Open the plan. */
  keyNode?: ReactNode;
  open?: boolean;
  lifted?: boolean;
  /** Whether it can be carried: an open task's note, while the office can be steered. */
  carries?: boolean;
  phone?: boolean;
  /** A copy drawn where a card was dropped, until its form's button is pressed: no link of its own. */
  copy?: boolean;
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onLinkKeyDown?: (event: KeyboardEvent<HTMLAnchorElement>) => void;
  onLinkFocus?: (event: FocusEvent<HTMLAnchorElement>) => void;
  onLinkBlur?: (event: FocusEvent<HTMLAnchorElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}

const MAX_SEGMENTS = 8;

/** A parent's parts as segments: one per part up to eight, then eight filled in proportion. */
function segments(done: number, total: number): boolean[] {
  if (total <= MAX_SEGMENTS) return Array.from({ length: total }, (_, i) => i < done);
  const filled = Math.round((done / total) * MAX_SEGMENTS);
  return Array.from({ length: MAX_SEGMENTS }, (_, i) => i < filled);
}

export function Note({ view, itemKey, linkTab = 0, move, keyNode, open = false, lifted = false, carries = false, phone = false, copy = false, onLinkClick, onLinkKeyDown, onLinkFocus, onLinkBlur, onPointerDown }: NoteProps) {
  const descId = `tb-desc-${view.id}${copy ? '-copy' : ''}`;
  const className = [
    'tb-note',
    view.tone === 'you' ? 'tb-note--you' : '',
    view.tone === 'done' ? 'tb-note--done' : '',
    view.tone === 'cancelled' ? 'tb-note--cancelled' : '',
    carries ? '' : 'tb-note--still',
    open ? 'is-open' : '',
    lifted ? 'is-lifted' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-hue={view.hue ?? ''} data-tb-note={view.id} onPointerDown={onPointerDown} aria-hidden={copy || undefined}>
      <div className="tb-note__band">
        <span className="tb-note__room">
          {view.tone === 'done' && (
            <span className="tb-tick" aria-hidden="true">
              <Glyph name="check" className="tb-glyph" />
            </span>
          )}
          <span className="tb-note__band-words">{view.band}</span>
        </span>
        <span className="tb-note__end">
          {view.changed && <span className="tb-note__dot" aria-hidden="true" />}
          {view.place && (
            <span className="tb-note__place" aria-hidden="true">
              {view.place}
            </span>
          )}
        </span>
      </div>
      <p className="tb-note__title">
        {copy ? (
          view.title
        ) : (
          <a
            className="tb-note__link"
            href={view.href}
            draggable={false}
            tabIndex={linkTab}
            aria-describedby={descId}
            aria-current={open ? 'true' : undefined}
            data-tb-key={itemKey}
            onClick={onLinkClick}
            onKeyDown={onLinkKeyDown}
            onFocus={onLinkFocus}
            onBlur={onLinkBlur}
          >
            {view.title}
          </a>
        )}
      </p>
      {/* After the link in the tab order ("Tab goes on to that card's Move and its button"), drawn on the band. */}
      {!phone && move && <span className="tb-note__move">{move}</span>}
      {(view.kind || view.check) && (
        <p className="tb-note__part">
          {view.kind && <span className="kind-tag kind-tag--note">{view.kind}</span>}
          {view.check && <span className={`kind-tag kind-tag--note kind-tag--${view.check.state}`}>{view.check.tag}</span>}
        </p>
      )}
      {view.part && (
        <p className="tb-note__part">
          <Glyph name="flag" />
          <span>{view.part}</span>
        </p>
      )}
      {view.parts && (
        <p className="tb-note__part">
          <span className="tb-note__segs" aria-hidden="true">
            {segments(view.parts.done, view.parts.total).map((on, i) => (
              <i key={i} className={on ? 'is-done' : undefined} />
            ))}
          </span>
          <span>{view.parts.line}</span>
        </p>
      )}
      {view.stuck && <span className="tb-note__stuck">{view.stuck}</span>}
      {/* The trouble tag says what a working card's line would; what a card waits on you for always shows. */}
      {(!view.stuck || view.tone === 'you') && <p className="tb-note__line">{view.line}</p>}
      <div className="tb-note__foot">
        <Face of={view.owner.face} size={phone ? 28 : 24} mark={view.owner.mark} needsYou={view.owner.needsYou} />
        <span className="tb-note__owner">{view.owner.name}</span>
        {view.milestone && (
          <span className="tb-note__ms">
            <Glyph name="flag" />
            <span>{view.milestone}</span>
          </span>
        )}
        {phone && move}
      </div>
      {keyNode}
      {!copy && (
        <span id={descId} hidden>
          {view.description}
          {view.changed ? ' Changed since you looked.' : ''}
        </span>
      )}
    </div>
  );
}
