// When an Undo line leaves while it has focus (its window closed), focus moves on to something near rather than dropping
// to the page: the line itself while it stays, the item's own focusable line, the item's marked spot or heading, the
// next thing in its region, else the region's heading. One rule for every UndoLine.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** What an Undo belongs to: an inbox item, a question, a row. A caller can mark its own with data-undo-item. */
const ITEM = '[data-undo-item], li, article';
/** Where the next thing is looked for: the tab, the panel, the wide view, a form. */
const REGION = '[role="tabpanel"], [role="dialog"], section, aside, form, main';

const shown = (el: HTMLElement | null | undefined): el is HTMLElement =>
  !!el && el.isConnected && el.getClientRects().length > 0 && el.closest('[inert]') === null;

/**
 * Notes, while `el` (the Undo or its line) is still in the page, where focus can go once it has left; the returned step
 * moves it there. The step does nothing when `el` came back (a render only re-attached it) or something else has focus.
 */
export function focusAfterLeaving(el: HTMLElement): () => void {
  const line = el.closest<HTMLElement>('.undo-line') ?? el;
  const item = line.closest<HTMLElement>(ITEM);
  const region = line.closest<HTMLElement>(REGION);
  // Focusable wrappers between the line and its item: the inbox's line, which says what happened once the Undo goes.
  const wrappers: HTMLElement[] = [];
  for (let at = line.parentElement; at && at !== region; at = at.parentElement) {
    if (at.hasAttribute('tabindex') && at.getAttribute('tabindex') === '-1') wrappers.push(at);
    if (at === item) break;
  }
  const after = Array.from((region ?? document.body).querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (x) => !line.contains(x) && (line.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  return () => {
    if (el.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const inItem = shown(item) ? (item.querySelector<HTMLElement>('[data-undo-focus]') ?? item.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')) : null;
    const target =
      (line !== el && shown(line) ? line : null) ??
      wrappers.find(shown) ??
      (shown(inItem) ? inItem : null) ??
      after.find(shown) ??
      region?.querySelector<HTMLElement>('[data-panel-heading]') ??
      (region?.hasAttribute('tabindex') ? region : null);
    if (!target) return;
    // A heading can take focus from a script without joining the tab order.
    if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) target.tabIndex = -1;
    target.focus();
  };
}
