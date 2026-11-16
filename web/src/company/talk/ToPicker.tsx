// "Who hears it" (docs/design-v3.md, "The To's picker"; "The phone"): pressing the To opens it. On desktops a non-modal
// dialog in a manual popover over the To: a search field ("Find someone, a room or a team", a combobox with
// aria-activedescendant) above the choices grouped as All hands, Rooms, Teams and People. Up and Down choose, Enter or a
// press picks; Escape clears the field's words, then closes it; a press outside closes it. On phones a modal <dialog>
// sheet whose focus starts on the first choice, so the keyboard rises only when the field is tapped.
import { type KeyboardEvent, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Recipient } from '../../../../src/core/steering.ts';
import { Face } from '../ui/Face.tsx';
import { faceOfRecipient, Glyph } from './bits.tsx';
import { placeAbove, showPopover } from './TalkList.tsx';
import { type ChoiceGroup, listStatus, matchIn, noOneCalled, rankChoices, type TalkChoice } from './talkModel.ts';

interface Props {
  id: string;
  snapshot: Pick<Snapshot, 'studio'>;
  company: CompanyView;
  choices: readonly TalkChoice[];
  phone: boolean;
  /** The To, which it opens over and which takes focus back when it closes. */
  anchor: RefObject<HTMLElement | null>;
  onPick: (to: Recipient) => void;
  onClose: () => void;
}

const GROUPS: { group: ChoiceGroup; title: string }[] = [
  { group: 'everyone', title: 'All hands' },
  { group: 'rooms', title: 'Rooms' },
  { group: 'teams', title: 'Teams' },
  { group: 'people', title: 'People' },
];

export function ToPicker({ id, snapshot, company, choices, phone, anchor, onPick, onClose }: Props) {
  const ids = useId();
  const listId = `${ids}-list`;
  const titleId = `${ids}-title`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [said, setSaid] = useState('');
  const pop = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  const found = query.trim() === '' ? [...choices] : rankChoices(choices, query, { allHands: true });
  const groups = GROUPS.map((g) => ({ ...g, options: found.filter((c) => c.group === g.group) })).filter((g) => g.options.length > 0);
  const flat = groups.flatMap((g) => g.options);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (c: TalkChoice) => `${listId}-${c.key}`;

  // Desktop: the popover over the To, focus in the field. Phone: the modal sheet, focus on the first choice.
  useLayoutEffect(() => {
    if (phone) {
      const d = sheet.current;
      if (d && !d.open) d.showModal();
      first.current?.focus();
      return;
    }
    showPopover(pop.current, true);
    if (pop.current && anchor.current) placeAbove(pop.current, anchor.current, false);
    field.current?.focus();
  }, [phone, anchor]);

  useLayoutEffect(() => {
    if (!phone && pop.current && anchor.current) placeAbove(pop.current, anchor.current, false);
  });

  // A press outside closes the desktop popover.
  useEffect(() => {
    if (phone) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (pop.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [phone, anchor, onClose]);

  // What the field found, said once typing pauses.
  const line = query.trim() === '' ? '' : flat.length === 0 ? noOneCalled(query) : listStatus(flat.length, 'mention', query);
  useEffect(() => {
    const timer = window.setTimeout(() => setSaid(line), 500);
    return () => window.clearTimeout(timer);
  }, [line]);

  useLayoutEffect(() => {
    const c = flat[current];
    if (!phone && c) document.getElementById(optionId(c))?.scrollIntoView({ block: 'nearest' });
  });

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      e.preventDefault();
      if (flat.length > 0) setActive(((to % flat.length) + flat.length) % flat.length);
    };
    if (e.key === 'ArrowDown') move(current + 1);
    else if (e.key === 'ArrowUp') move(current - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      const c = flat[current];
      if (c) onPick(c.recipient);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        setQuery('');
        setActive(0);
      } else onClose();
    }
  };

  const label = (c: TalkChoice) => {
    const match = matchIn(c.label, query);
    if (!match) return c.label;
    return (
      <>
        {c.label.slice(0, match[0])}
        <b>{c.label.slice(match[0], match[1])}</b>
        {c.label.slice(match[1])}
      </>
    );
  };

  const search = (
    <div className="tpop__search">
      <label className="visually-hidden" htmlFor={`${ids}-field`}>
        Find someone, a room or a team
      </label>
      <input
        ref={field}
        id={`${ids}-field`}
        className="tpop__field"
        type="text"
        role={phone ? undefined : 'combobox'}
        autoComplete="off"
        spellCheck={false}
        placeholder="Find someone, a room or a team"
        value={query}
        aria-controls={phone ? undefined : listId}
        aria-expanded={phone ? undefined : true}
        aria-autocomplete={phone ? undefined : 'list'}
        aria-activedescendant={!phone && flat[current] ? optionId(flat[current]) : undefined}
        aria-describedby={`${ids}-said`}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={phone ? undefined : onFieldKey}
      />
      <p id={`${ids}-said`} className="visually-hidden" role="status">
        {said}
      </p>
    </div>
  );

  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.options.length, 0));
  if (phone) {
    return (
      <dialog
        ref={sheet}
        id={id}
        className="tsheet"
        aria-labelledby={titleId}
        onCancel={(e) => {
          // Escape clears the field's words first, as search fields do; then it closes the sheet.
          e.preventDefault();
          if (query) {
            setQuery('');
            field.current?.focus();
          } else onClose();
        }}
        onClick={(e) => {
          // A press on the scrim lands on the dialog itself.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="tsheet__head">
          <h2 id={titleId} className="tsheet__title">
            Who hears it
          </h2>
          <button type="button" className="tsheet__close" aria-label="Close" onClick={onClose}>
            <Glyph name="close" />
          </button>
        </div>
        {search}
        <div className="tsheet__list">
          {groups.length === 0 && <p className="tpop__empty">{noOneCalled(query)}</p>}
          {groups.map((g, gi) => (
            <section key={g.group} aria-label={g.title}>
              <h3 className="tpop__group">{g.title}</h3>
              {g.options.map((c, oi) => {
                const isFirst = gi === 0 && oi === 0;
                return (
                  <button key={c.key} ref={isFirst ? first : undefined} type="button" className="tpop__option tpop__option--button" onClick={() => onPick(c.recipient)}>
                    <Face of={faceOfRecipient(snapshot, company, c.recipient)} size={28} />
                    <span className="tpop__main">
                      <span className="tpop__label">{label(c)}</span>
                      <span className="tpop__detail">{c.detail}</span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </dialog>
    );
  }

  return (
    <div ref={pop} id={id} popover="manual" role="dialog" aria-labelledby={titleId} className="tpop tpop--picker">
      <p id={titleId} className="tpop__title">
        Who hears it
      </p>
      {search}
      <div id={listId} role="listbox" aria-label="Who hears it" className="tpop__list">
        {groups.map((g, gi) => (
          <div key={g.group} role="group" aria-labelledby={`${listId}-group-${g.group}`}>
            <div id={`${listId}-group-${g.group}`} role="presentation" className="tpop__group">
              {g.title}
            </div>
            {g.options.map((c, oi) => {
              const index = (starts[gi] ?? 0) + oi;
              return (
                <div
                  key={c.key}
                  id={optionId(c)}
                  role="option"
                  aria-selected={index === current}
                  className={`tpop__option${index === current ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (index !== current) setActive(index);
                  }}
                  onClick={() => onPick(c.recipient)}
                >
                  <Face of={faceOfRecipient(snapshot, company, c.recipient)} size={28} />
                  <span className="tpop__main">
                    <span className="tpop__label">{label(c)}</span>
                    <span className="tpop__detail">{c.detail}</span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {flat.length === 0 && <p className="tpop__empty">{noOneCalled(query)}</p>}
    </div>
  );
}
