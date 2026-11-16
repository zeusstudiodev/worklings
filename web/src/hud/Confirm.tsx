// A modal confirmation built on <dialog>, which traps focus and closes on Escape by itself.
import { useEffect, useRef } from 'react';

export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="confirm" onClose={onCancel} aria-labelledby="confirm-title">
      <h2 id="confirm-title" className="confirm__title">{title}</h2>
      <p className="confirm__body">{body}</p>
      <div className="confirm__actions">
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
        <button type="button" className={`button ${danger ? 'button--danger' : 'button--primary'}`} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
