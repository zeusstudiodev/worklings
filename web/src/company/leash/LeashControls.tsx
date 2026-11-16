// The leash, model and effort (SPEC-v3.md "Steering" 6): a person's controls for their panel, a room's leash, and an
// overview of every room's leash and everyone with their own, for Settings. Selects with Save, like the person's other
// levers, then "Saved. Undo" in place; they call changeSettings, and model and effort apply at the person's next desk.
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CompanyView, PersonView } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Leash, SettingsChange } from '../../../../src/core/steering.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { reconnectingLine } from '../model.ts';
import { flatten, orgOutline, roomName } from '../people/peopleModel.ts';
import { CompanyLink, refusalOf } from '../people/shared.tsx';
import type { SteeringActions, TabProps } from '../types.ts';
import { UndoLine } from '../ui/UndoLine.tsx';
import {
  appliesLine,
  changeOf,
  effortChoices,
  LEASH_MEANS,
  LEASH_WORDS,
  leashChoices,
  leashSource,
  leashWith,
  modelChoices,
  ownLeashes,
  ownLeashesLine,
  type PersonDraft,
  personDraft,
  roomChange,
  roomChoices,
  roomLeash,
  roomSavedLine,
  savedLine,
  steeringOf,
} from './leashModel.ts';
import './leash.css';

/** "Saved. Undo" stays this long, as other settings' do. */
const UNDO_WINDOW_MS = 10_000;

interface Saved {
  text: string;
  ok: boolean;
  until: number | null;
  /** The change that puts it back; null once used or where nothing can. */
  undo: SettingsChange | null;
}

const sameDraft = (a: PersonDraft, b: PersonDraft) => a.leash === b.leash && a.model === b.model && a.effort === b.effort;

interface ControlProps {
  snapshot: Pick<Snapshot, 'studio' | 'serverTime'>;
  company: CompanyView;
  steer: SteeringActions;
  online: boolean;
  announce: (text: string) => void;
}

/** A person's leash, model and effort, for their panel or Details. */
export function PersonSettings({ snapshot, company, person, steer, online, announce }: ControlProps & { person: PersonView }) {
  const id = useId();
  const current = personDraft(company, person);
  const [edited, setEdited] = useState<PersonDraft | null>(null);
  // What was saved, shown until the stream brings it, so the selects don't flick back to the old values in between.
  const [saving, setSaving] = useState<PersonDraft | null>(null);
  if (saving && sameDraft(saving, current)) setSaving(null);
  const base = saving ?? current;
  const shown = edited ?? base;
  const change = changeOf(person.id, base, shown);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const now = steeringOf(company, person.id);
  const leashNow = leashWith(company, person, shown);

  const set = (patch: Partial<PersonDraft>) => {
    const next = { ...shown, ...patch };
    setEdited(sameDraft(next, base) ? null : next);
  };

  const apply = async (what: SettingsChange, before: PersonDraft, after: PersonDraft, text: string, undoable: boolean) => {
    setBusy(true);
    let handTo: HTMLElement | null = null;
    try {
      await steer.changeSettings(what);
      flushSync(() => {
        setSaving(after);
        setEdited(null);
        // Nothing left to undo after an Undo: no Undo button waits out its window disabled.
        setSaved({ text, ok: true, until: undoable ? Date.now() + UNDO_WINDOW_MS : null, undo: undoable ? changeOf(person.id, after, before) : null });
      });
      // Save is gone and the line that replaces it carries the Undo; after an Undo, the controls it put back (once they
      // are enabled again, below).
      handTo = undoable ? undoButton.current : document.getElementById(`${id}-leash`);
      announce(text);
    } catch (error) {
      const why = `Couldn't save: ${refusalOf(error)}`;
      setSaved({ text: why, ok: false, until: 0, undo: null });
      announce(why);
    } finally {
      flushSync(() => setBusy(false));
      handOver(handTo);
    }
  };

  const save = () => {
    if (!change || !online || busy) return;
    void apply(change, base, shown, `Saved. ${savedLine(company, person, base, shown)}`, true);
  };

  const undo = () => {
    if (!saved?.undo || !online || busy) return;
    void apply(saved.undo, base, draftOf(saved.undo, base), 'Put back as it was.', false);
  };

  const field = (key: keyof PersonDraft, label: string, choices: readonly { value: string; label: string }[], describedBy?: string) => (
    <div className="field leash-controls__field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <select
        id={`${id}-${key}`}
        className="select-input"
        value={shown[key]}
        disabled={busy}
        aria-describedby={describedBy}
        onChange={(e) => {
          const value = e.target.value;
          if (key === 'leash') {
            const choice = leashChoices(company, person).find((c) => c.value === value);
            if (choice) set({ leash: choice.value });
          } else if (key === 'effort') {
            const choice = effortChoices().find((c) => c.value === value);
            if (choice) set({ effort: choice.value });
          } else set({ model: value });
        }}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section className="leash-controls" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="group-title">
        Leash, model and effort
      </h3>
      {field('leash', 'Leash', leashChoices(company, person), `${id}-means`)}
      <p id={`${id}-means`} className="leash-controls__means">
        {LEASH_WORDS[leashNow]}: {LEASH_MEANS[leashNow]}
        {!edited && <> {leashSource(snapshot, person, now)}</>}
      </p>
      {field('model', 'Model', modelChoices(person.model), `${id}-applies`)}
      {field('effort', 'Effort', effortChoices(), `${id}-applies`)}
      <p id={`${id}-applies`} className="leash-controls__applies">
        {appliesLine(person)}
      </p>
      {change && (
        <div className="leash-controls__save">
          <button type="button" className="button button--primary" aria-disabled={!online || busy || undefined} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => setEdited(null)}>
            Cancel
          </button>
          {!online && <p className="leash-controls__offline">{reconnectingLine(snapshot.serverTime)}</p>}
        </div>
      )}
      {saved &&
        (saved.ok ? (
          <UndoLine ref={undoButton} text={saved.text} until={saved.until} onUndo={undo} unavailable={!online || busy || saved.undo === null} />
        ) : (
          <p className="leash-controls__failed">{saved.text}</p>
        ))}
    </section>
  );
}

/** Focus follows a press to what replaced its button, unless the person has already gone elsewhere. */
function handOver(to: HTMLElement | null) {
  const at = document.activeElement;
  if (!to || (at && at !== document.body && at.isConnected)) return;
  to.focus();
}

/** The draft a change leads to from `base`: what the selects show after an Undo. */
function draftOf(change: SettingsChange, base: PersonDraft): PersonDraft {
  const out = { ...base };
  if (change.leash && 'person' in change.leash) out.leash = change.leash.leash ?? 'room';
  if (change.model) out.model = change.model.model;
  if (change.effort) out.effort = change.effort.effort ?? 'default';
  return out;
}

/** One room's leash: a select with Save, and who in the room keeps their own. */
export function RoomLeash({ snapshot, company, room, steer, online, announce }: ControlProps & { room: string }) {
  const id = useId();
  const current: Leash = roomLeash(company, room) ?? 'default';
  const [edited, setEdited] = useState<Leash | null>(null);
  const [saving, setSaving] = useState<Leash | null>(null);
  if (saving !== null && saving === current) setSaving(null);
  const base = saving ?? current;
  const shown = edited ?? base;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const keepers = ownLeashesLine(ownLeashes(company, room));
  const name = roomName(snapshot, room);

  const apply = async (leash: Leash, before: Leash, text: string, undoable: boolean) => {
    setBusy(true);
    let handTo: HTMLElement | null = null;
    try {
      await steer.changeSettings(roomChange(room, leash));
      flushSync(() => {
        setSaving(leash);
        setEdited(null);
        setSaved({ text, ok: true, until: undoable ? Date.now() + UNDO_WINDOW_MS : null, undo: undoable ? roomChange(room, before) : null });
      });
      handTo = undoable ? undoButton.current : document.getElementById(`${id}-leash`);
      announce(text);
    } catch (error) {
      const why = `Couldn't save: ${refusalOf(error)}`;
      setSaved({ text: why, ok: false, until: 0, undo: null });
      announce(why);
    } finally {
      flushSync(() => setBusy(false));
      handOver(handTo);
    }
  };

  return (
    <div className="room-leash">
      <div className="room-leash__row">
        <label className="room-leash__name" htmlFor={`${id}-leash`}>
          {name}
        </label>
        <select
          id={`${id}-leash`}
          className="select-input room-leash__select"
          value={shown}
          disabled={busy}
          aria-describedby={`${id}-means`}
          onChange={(e) => {
            const choice = roomChoices().find((c) => c.value === e.target.value);
            if (choice) setEdited(choice.value === base ? null : choice.value);
          }}
        >
          {roomChoices().map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {edited !== null && (
          <button
            type="button"
            className="button button--primary"
            aria-disabled={!online || busy || undefined}
            onClick={() => {
              if (online && !busy) void apply(edited, base, `Saved. ${roomSavedLine(snapshot, room, edited)}`, true);
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <p id={`${id}-means`} className="room-leash__means">
        {LEASH_MEANS[shown]}
        {keepers && <> {keepers}</>}
      </p>
      {saved &&
        (saved.ok ? (
          <UndoLine
            ref={undoButton}
            text={saved.text}
            until={saved.until}
            unavailable={!online || busy || saved.undo === null}
            onUndo={() => {
              const back = saved.undo?.leash;
              if (back && 'room' in back) void apply(back.leash ?? 'default', base, 'Put back as it was.', false);
            }}
          />
        ) : (
          <p className="leash-controls__failed">{saved.text}</p>
        ))}
    </div>
  );
}

/** Every room's leash and everyone with a leash of their own, for Settings; `headingClass` matches the page's headings. */
export function LeashOverview({
  snapshot,
  company,
  companyId,
  navigate,
  steer,
  online,
  announce,
  headingClass = 'group-title',
}: Pick<TabProps, 'snapshot' | 'company' | 'companyId' | 'navigate' | 'online' | 'announce'> & { steer: SteeringActions; headingClass?: string }) {
  const id = useId();
  const people = flatten(orgOutline(snapshot, company)).map((n) => n.person);
  const rooms = [...new Set(people.map((p) => p.room))];
  const own = people.flatMap((p) => {
    const s = steeringOf(company, p.id);
    return s.leashFrom === 'person' ? [{ p, leash: s.leash }] : [];
  });
  return (
    <section className="leash-overview" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className={headingClass}>
        Leash per room
      </h3>
      <p className="leash-overview__note">Checks with you holds each new task until you say start. Trusted lets them do routine work in the project without asking. A person's own leash wins over their room's.</p>
      <ul className="leash-overview__rooms">
        {rooms.map((room) => (
          <li key={room}>
            <RoomLeash snapshot={snapshot} company={company} room={room} steer={steer} online={online} announce={announce} />
          </li>
        ))}
      </ul>
      <h3 className={headingClass}>People with their own leash</h3>
      {own.length === 0 ? (
        <p className="leash-overview__note">Nobody has a leash of their own. Set one from their panel.</p>
      ) : (
        <ul className="leash-overview__people">
          {own.map(({ p, leash }) => (
            <li key={p.id}>
              <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(p.id)}`} navigate={navigate} className="link" focusKey={`leash:${p.id}`}>
                {personLabel(p)}
              </CompanyLink>
              : {LEASH_WORDS[leash]}.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
