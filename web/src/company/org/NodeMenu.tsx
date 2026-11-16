// A node's More (docs/design-v3.md, "Hire, fire, move"): Message Kai, Stop Kai (while working), Change Kai's model,
// Move Kai to another room, Fire Kai. A menu in the top layer beside the node, opened by its ⋯ key or Shift+F10 on the
// focused node; its model and room choices open in the same menu, with Back. Escape or a press outside closes it and
// focus goes back to what opened it.
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuChoice {
  value: string;
  label: string;
  /** "Now", for the current one. */
  hint?: string | null;
}

export interface NodeMenuProps {
  /** The node or ⋯ key it opened from: it sits beside it, and focus goes back there. */
  anchor: HTMLElement;
  name: string;
  /** Why changes wait (the office is reconnecting); null when they can be made. */
  unavailable: string | null;
  canStop: boolean;
  /** Null where nobody can be moved or fired (the CEO). */
  rooms: MenuChoice[] | null;
  models: MenuChoice[];
  onMessage: () => void;
  onStop: () => void;
  onModel: (model: string) => void;
  onMove: ((room: string) => void) | null;
  onFire: (() => void) | null;
  onClose: (refocus: boolean) => void;
}

type Page = 'main' | 'model' | 'move';

export function NodeMenu(props: NodeMenuProps) {
  const { anchor, name, unavailable, canStop, rooms, models, onMessage, onStop, onModel, onMove, onFire, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>('main');
  const closing = useRef(false);

  // Opened beside the node, kept inside the window, focus on its first item.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.matches(':popover-open')) el.showPopover();
    const at = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const right = at.right + 8 + w <= window.innerWidth - 8;
    el.style.left = `${Math.round(right ? at.right + 8 : Math.max(8, at.left - 8 - w))}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(at.top, window.innerHeight - h - 8)))}px`;
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [anchor, page]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed' && !closing.current) {
        closing.current = true;
        // Light dismiss: Escape gives focus back; a press elsewhere keeps it where it went.
        const active = document.activeElement;
        onClose(active === null || active === document.body || el.contains(active));
      }
    };
    el.addEventListener('toggle', toggled);
    return () => el.removeEventListener('toggle', toggled);
  }, [onClose]);

  const close = (refocus: boolean) => {
    if (closing.current) return;
    closing.current = true;
    ref.current?.hidePopover();
    onClose(refocus);
  };
  const act = (fn: () => void, changes = true) => {
    if (changes && unavailable) return;
    close(false);
    fn();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = (j: number) => {
      e.preventDefault();
      items[(j + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowUp') to(i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (page !== 'main') setPage('main');
      else close(true);
    } else if (e.key === 'ArrowLeft' && page !== 'main') {
      e.preventDefault();
      setPage('main');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div ref={ref} className="org-menu" popover="auto" role="menu" aria-label={page === 'main' ? `More for ${name}` : page === 'model' ? `${name}'s model` : `Move ${name} to`} onKeyDown={onKey}>
      {page === 'main' ? (
        <>
          <Item label={`Message ${name}`} onSelect={() => act(onMessage, false)} />
          {canStop && <Item label={`Stop ${name}`} onSelect={() => act(onStop, false)} />}
          <Item label={`Change ${name}'s model`} onSelect={() => !unavailable && setPage('model')} disabled={Boolean(unavailable)} more />
          {onMove && rooms && rooms.length > 0 && <Item label={`Move ${name} to another room`} onSelect={() => !unavailable && setPage('move')} disabled={Boolean(unavailable)} more />}
          {onFire && <Item label={`Fire ${name}`} onSelect={() => act(onFire)} disabled={Boolean(unavailable)} danger />}
          {unavailable && <p className="org-menu__note">{unavailable}</p>}
        </>
      ) : (
        <>
          <Item label="Back" onSelect={() => setPage('main')} />
          <p className="org-menu__title" aria-hidden="true">
            {page === 'model' ? `${name}'s model` : `Move ${name} to`}
          </p>
          {(page === 'model' ? models : (rooms ?? [])).map((c) => (
            <button key={c.value} type="button" role="menuitem" className="org-menu__item" aria-disabled={c.hint === 'Now' || undefined} onClick={c.hint === 'Now' ? undefined : () => act(() => (page === 'model' ? onModel(c.value) : onMove?.(c.value)))}>
              {c.label}
              {c.hint && <span className="org-menu__hint">{c.hint}</span>}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function Item({ label, onSelect, disabled = false, danger = false, more = false }: { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; more?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`org-menu__item${danger ? ' org-menu__item--danger' : ''}`}
      aria-disabled={disabled || undefined}
      aria-haspopup={more ? 'menu' : undefined}
      onClick={onSelect}
    >
      {label}
      {more && (
        <span className="org-menu__more" aria-hidden="true">
          ›
        </span>
      )}
    </button>
  );
}
