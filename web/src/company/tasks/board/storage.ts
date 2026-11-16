// What the task board keeps in this browser: its filters for the tab (sessionStorage, per company), and what each card
// was when you last left the board, for "New since you looked" (localStorage, per company). Storage can be switched off
// or full; then the board works without it, as on a first visit.
import { type BoardFilters, filtersFrom, NO_FILTERS, type Seen, seenFrom } from './columns.ts';

const filtersKey = (company: string) => `worklings-board-filters:${company}`;
const seenKey = (company: string) => `worklings-board-seen:${company}`;

const parsed = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Something else wrote the key: read as nothing kept.
    return null;
  }
};

export function readFilters(company: string): BoardFilters {
  try {
    return filtersFrom(parsed(sessionStorage.getItem(filtersKey(company))));
  } catch {
    // Storage is switched off: no filters kept, so none apply.
    return NO_FILTERS;
  }
}

export function keepFilters(company: string, filters: BoardFilters): void {
  try {
    sessionStorage.setItem(filtersKey(company), JSON.stringify(filters));
  } catch {
    // Not kept where storage is switched off; the filters still hold while the board is open.
  }
}

export function readSeen(company: string): Seen | null {
  try {
    return seenFrom(parsed(localStorage.getItem(seenKey(company))));
  } catch {
    // Storage is switched off: every visit is a first visit, which marks nothing.
    return null;
  }
}

export function keepSeen(company: string, seen: Seen): void {
  try {
    localStorage.setItem(seenKey(company), JSON.stringify(seen));
  } catch {
    // Not kept where storage is switched off or full; the next visit marks nothing, as a first one does.
  }
}
