// Your unsaved changes to a company's plan, kept for this tab's life (session storage), so a reload or a trip to another
// view doesn't lose them. Read back through draftFrom, which treats what it finds as data, not as trusted changes.
import { useEffect, useState } from 'react';
import { type Draft, draftFrom, EMPTY_DRAFT } from './planEdit.ts';

const keyOf = (companyId: string) => `worklings-plan-draft:${companyId}`;

function read(key: string): Draft {
  try {
    return draftFrom(JSON.parse(sessionStorage.getItem(key) ?? 'null') as unknown);
  } catch {
    // Storage switched off or a damaged entry: no draft to pick up.
    return EMPTY_DRAFT;
  }
}

function keep(key: string, draft: Draft) {
  try {
    if (draft.ops.length === 0 && !draft.note) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage switched off or full: the draft still holds while the view is open.
  }
}

export function useDraft(companyId: string): [Draft, (change: (draft: Draft) => Draft) => void] {
  const key = keyOf(companyId);
  const [held, setHeld] = useState(() => ({ key, draft: read(key) }));
  // Another company's view: its own draft, React's pattern for state that follows a prop.
  if (held.key !== key) setHeld({ key, draft: read(key) });
  useEffect(() => keep(held.key, held.draft), [held]);
  const change = (update: (draft: Draft) => Draft) => setHeld((h) => ({ key: h.key, draft: update(h.draft) }));
  return [held.key === key ? held.draft : EMPTY_DRAFT, change];
}
