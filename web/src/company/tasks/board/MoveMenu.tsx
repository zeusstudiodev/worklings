// Move (docs/design-v3.md, "The keyboard way"): a menu button on every open task's note, whose items cover every drop
// in today's words, so someone who never drags has them all. On desktops a menu in the top layer beside its key (a
// popover, so nothing covers it); on phones an action sheet, a native dialog opened with showModal. Closing either puts
// focus back on Move, unless the item chosen sends it somewhere (the card, a form, the task).
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { MoveAction, MoveItem } from './drops.ts';
import { Glyph, type GlyphName } from './Glyph.tsx';

const GLYPH: Readonly<Record<MoveAction, GlyphName>> = {
  start: 'resume',
  top: 'top',
  up: 'up',
  down: 'down',
  bottom: 'bottom',
  pick: 'pick',
  pause: 'pause',
  resume: 'resume',
  reassign: 'person',
  cancel: 'close',
  open: 'open',
};

/** Items that only look: Open is navigation, so it works while the office is out of reach. */
const SENDS = (action: MoveAction) => action !== 'open';

interface MoveMenuProps {
  /** The task's title, as Move's name and the menu's: "Move “Cart summary”". */
  title: string;
  items: readonly MoveItem[];
  phone: boolean;
  /** Why the items that change something are unavailable (reconnecting, no steering), or null. */
  unavailable: string | null;
  /** The board's roving tab stop: Move is in the tab order only on the card that holds it. */
  tabbable: boolean;
  onPick: (action: MoveAction) => void;
}

export function MoveMenu({ title, items, phone, unavailable, tabbable, onPick }: MoveMenuProps) {
  const id = useId();
  const name = `Move “${title}”`;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Set when an item was chosen: the board places focus then, so closing leaves it alone.
  const chose = useRef(false);

  const itemsOf = () => Array.from((phone ? sheet.current : menu.current)?.querySelectorAll<HTMLButtonElement>('[data-tb-option]') ?? []);

  const place = () => {
    const b = button.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    const width = m.offsetWidth;
    const height = m.offsetHeight;
    const left = Math.max(8, Math.min(b.right - width, window.innerWidth - width - 8));
    const below = b.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, b.top - height - 4) : below;
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
  };

  // The items are drawn only while the menu is open: a board of a hundred notes keeps a hundred closed menus empty.
  const show = () => {
    chose.current = false;
    flushSync(() => setOpen(true));
    if (phone) sheet.current?.showModal();
    else {
      menu.current?.showPopover();
      place();
    }
    itemsOf()[0]?.focus();
  };

  const hide = () => {
    if (phone) sheet.current?.close();
    else if (menu.current?.matches(':popover-open')) menu.current.hidePopover();
  };

  const pick = (item: MoveItem) => {
    if (unavailable && SENDS(item.action)) return;
    chose.current = true;
    hide();
    onPick(item.action);
  };

  // Closed by Escape, a press outside or Tab: focus goes back to Move, unless an item sent it on.
  const closed = () => {
    setOpen(false);
    if (chose.current) return;
    const at = document.activeElement;
    const inside = at === document.body || (at instanceof Node && ((menu.current?.contains(at) ?? false) || (sheet.current?.contains(at) ?? false)));
    if (inside) button.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLElement>) => {
    const list = itemsOf();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      event.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(list.length - 1);
        break;
      case 'Tab':
        if (!phone) hide();
        break;
      case 'Escape':
        // The menu's own: it never reaches the board or the shell.
        event.preventDefault();
        event.stopPropagation();
        hide();
        break;
    }
  };

  const options = items.map((item) => (
    <button
      key={item.action}
      type="button"
      className={`tb-menu__item${item.danger ? ' tb-menu__item--danger' : ''}`}
      role={phone ? undefined : 'menuitem'}
      tabIndex={phone ? 0 : -1}
      data-tb-option
      aria-disabled={(unavailable !== null && SENDS(item.action)) || undefined}
      onClick={() => pick(item)}
    >
      <Glyph name={GLYPH[item.action]} className="" />
      <span>{item.label}</span>
    </button>
  ));

  return (
    <>
      <button
        ref={button}
        type="button"
        className="tb-move"
        aria-label={name}
        aria-haspopup={phone ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        tabIndex={tabbable ? 0 : -1}
        title={phone ? undefined : name}
        onClick={() => (open ? hide() : show())}
      >
        {phone ? 'Move' : <Glyph name="dots" className="tb-glyph" />}
      </button>
      {phone ? (
        <dialog
          ref={sheet}
          id={`${id}-menu`}
          className="tb-sheet"
          aria-labelledby={`${id}-title`}
          aria-describedby={unavailable ? `${id}-why` : undefined}
          onClose={closed}
          onKeyDown={onMenuKey}
          onClick={(event) => {
            // A press on the scrim (the dialog's own box, outside its content) closes it.
            if (event.target === event.currentTarget) hide();
          }}
        >
          <div className="tb-sheet__grab" aria-hidden="true" />
          <p id={`${id}-title`} className="tb-menu__title">
            {name}
          </p>
          {unavailable && (
            <p id={`${id}-why`} className="tb-menu__why">
              {unavailable}
            </p>
          )}
          {open && options}
          <button type="button" className="tb-sheet__close" onClick={hide}>
            Close
          </button>
        </dialog>
      ) : (
        <div
          ref={menu}
          id={`${id}-menu`}
          className="tb-menu"
          popover="auto"
          onToggle={(event) => {
            if (event.newState === 'closed') closed();
          }}
          onKeyDown={onMenuKey}
        >
          <p className="tb-menu__title" aria-hidden="true">
            {name}
          </p>
          {unavailable && (
            <p id={`${id}-why`} className="tb-menu__why">
              {unavailable}
            </p>
          )}
          <div role="menu" aria-label={name} aria-describedby={unavailable ? `${id}-why` : undefined}>
            {open && options}
          </div>
        </div>
      )}
    </>
  );
}
