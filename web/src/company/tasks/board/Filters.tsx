// The task board's filters and grouping (docs/design-v3.md, "Filters and grouping"): Who (everyone, a room, a person),
// Milestone, "Find a task" and Group (None, Person, Room). On desktops they are chips in the board's head, which folds
// them behind its Filter key when it runs short of room (BoardFrame); "12 of 51 tasks", said once typing pauses, and
// Show all stay outside them so they are seen and heard whatever the head does. On phones a Filter chip opens a sheet.
// Each picker is a native select inside its chip, so it keeps the platform's keys and list.
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CompanyView } from '../../../../../src/core/company.ts';
import { choiceName, peopleByRoom } from '../boardModel.ts';
import { type BoardFilters, filtering, type Grouping, NO_FILTERS } from './columns.ts';
import { Glyph } from './Glyph.tsx';

/** How long typing pauses before the count is said. */
const SAID_AFTER_MS = 500;

/** `text` once it has stopped changing for a moment, so a screen reader hears the count once typing pauses. */
function useSettled(text: string, ms = SAID_AFTER_MS): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(text), ms);
    return () => window.clearTimeout(id);
  }, [text, ms]);
  return settled;
}

/** How many of the filters are on, for the folded Filter key ("Filter, 2 on"). */
export const filtersOn = (f: BoardFilters): number => [f.who !== '', f.milestone !== '', f.find.trim() !== '', f.group !== 'none'].filter(Boolean).length;

interface FieldsProps {
  company: CompanyView;
  roomName: (room: string) => string;
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
}

function Chip({ label, children, on }: { label: string; children: ReactNode; on: boolean }) {
  return (
    <label className={`tb-chip${on ? ' is-on' : ''}`}>
      <span className="tb-chip__label">{label}</span>
      {children}
    </label>
  );
}

/** The pickers and Find, as chips in a row. */
export function FilterFields({ company, roomName, filters, onChange }: FieldsProps) {
  const id = useId();
  const set = (change: Partial<BoardFilters>) => onChange({ ...filters, ...change });
  const groups = peopleByRoom(company, roomName);
  const milestones = company.goal?.milestones ?? [];
  return (
    <div className="tb-filters" role="group" aria-label="Filters">
      <Chip label="Who" on={filters.who !== ''}>
        <select value={filters.who} data-tb-filter="who" onChange={(e) => set({ who: e.target.value })}>
          <option value="">Everyone</option>
          {groups.map((g) => (
            <optgroup key={g.room} label={g.name}>
              <option value={`room:${g.room}`}>Everyone in {g.name}</option>
              {g.people.map((p) => (
                <option key={p.id} value={`person:${p.id}`}>
                  {choiceName(p)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Chip>
      {milestones.length > 0 && (
        <Chip label="Milestone" on={filters.milestone !== ''}>
          <select value={filters.milestone} onChange={(e) => set({ milestone: e.target.value })}>
            <option value="">All</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Chip>
      )}
      <span className="tb-find">
        <label className="visually-hidden" htmlFor={`${id}-find`}>
          Find a task
        </label>
        <Glyph name="search" className="" />
        <input
          id={`${id}-find`}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Find a task"
          value={filters.find}
          maxLength={200}
          onChange={(e) => set({ find: e.target.value })}
          onKeyDown={(e) => {
            // A search field with words clears them; an empty one leaves Escape to the board.
            if (e.key === 'Escape' && filters.find !== '') {
              e.preventDefault();
              e.stopPropagation();
              set({ find: '' });
            }
          }}
        />
      </span>
      <Chip label="Group" on={filters.group !== 'none'}>
        <select value={filters.group} onChange={(e) => set({ group: groupOf(e.target.value) })}>
          <option value="none">None</option>
          <option value="person">Person</option>
          <option value="room">Room</option>
        </select>
      </Chip>
    </div>
  );
}

const groupOf = (value: string): Grouping => (value === 'person' || value === 'room' ? value : 'none');

/**
 * "12 of 51 tasks" by the filters, said once typing pauses, and Show all while a filter is on. Show all keeps the
 * grouping (it hides nothing) and puts focus on Who, since the key itself goes.
 */
export function FilterCount({ filters, found, onChange, onShowAll }: { filters: BoardFilters; found: string; onChange: (next: BoardFilters) => void; onShowAll?: () => void }) {
  const on = filtering(filters);
  const said = useSettled(on ? found : '');
  return (
    <>
      <span className="tb-found" role="status">
        {said}
      </span>
      {on && (
        <button
          type="button"
          className="tb-showall"
          onClick={() => {
            flushSync(() => onChange({ ...NO_FILTERS, group: filters.group }));
            onShowAll?.();
          }}
        >
          Show all
        </button>
      )}
    </>
  );
}

/** Phones: the Filter chip ("Filter: by person" while grouped) and its sheet, a native dialog over the board. */
export function FilterSheet(props: FieldsProps & { found: string }) {
  const id = useId();
  const sheet = useRef<HTMLDialogElement>(null);
  const key = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { filters } = props;
  const label = filters.group === 'person' ? 'Filter: by person' : filters.group === 'room' ? 'Filter: by room' : 'Filter';
  const on = filtersOn(filters) > 0;
  return (
    <>
      <button
        ref={key}
        type="button"
        className={`tb-filterkey${on ? ' is-on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-sheet`}
        onClick={() => {
          flushSync(() => setOpen(true));
          sheet.current?.showModal();
          sheet.current?.querySelector<HTMLElement>('select')?.focus();
        }}
      >
        <Glyph name="filter" className="" />
        {label}
      </button>
      <dialog
        ref={sheet}
        id={`${id}-sheet`}
        className="tb-sheet"
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          key.current?.focus();
        }}
        onClick={(event) => {
          // A press on the scrim (the dialog's own box, outside its content) closes it.
          if (event.target === event.currentTarget) sheet.current?.close();
        }}
      >
        <div className="tb-sheet__grab" aria-hidden="true" />
        <p id={`${id}-title`} className="tb-menu__title">
          Filter the tasks
        </p>
        {open && (
          <>
            <FilterFields {...props} />
            <p className="tb-sheet__count">
              <FilterCount filters={filters} found={props.found} onChange={props.onChange} onShowAll={() => sheet.current?.querySelector<HTMLElement>('select')?.focus()} />
            </p>
          </>
        )}
        <button type="button" className="tb-sheet__close" onClick={() => sheet.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
