// Direct edits to the proposal, in the panel (docs/design-v3.md, "The proposal"): a person's card opens their form, a
// column's "Add someone" adds a library role or asks the CEO to write one, "Add a room" adds a room. Each applies at
// once; the panel shows Undo in place.
import { useId, useRef, useState } from 'react';
import { BASE_DEPARTMENT_INFO, BASE_DEPARTMENTS, type BaseDepartment } from '../../../../src/core/departments.ts';
import { type OrgProposal, PROPOSAL_LIMITS, type ProposedPerson } from '../../../../src/core/org.ts';
import type { InstalledCatalogue } from '../../../../src/core/spending.ts';
import { ROLE_MODELS, type RoleModel } from '../../../../src/core/studio.ts';
import { LoadsFields } from '../spending/LoadsFields.tsx';
import { loadsOf, loadsToWrite, mcpNamed, sameResolved } from '../spending/spendingModel.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { type Catalogue, fieldCount, libraryProblem, managerChoices, MODEL_NAMES, named, ownsOf, type PersonEdit } from './model.ts';

const isModel = (v: string): v is RoleModel => (ROLE_MODELS as readonly string[]).includes(v);
const isBase = (v: string): v is BaseDepartment => (BASE_DEPARTMENTS as readonly string[]).includes(v);

interface PersonFormProps {
  proposal: OrgProposal;
  person: ProposedPerson;
  unavailable: string | null;
  /** What the user has installed to give people (before the start). */
  catalogue?: InstalledCatalogue | null;
  onSave: (edit: PersonEdit) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** A name holds up to 40 characters (PERSON_NAME). */
const NAME_MAX = 40;

/** "54 of 60" under a field once it is three quarters full, tied to the field by its id. */
function Counted({ id, text, max }: { id: string; text: string; max: number }) {
  const count = fieldCount(text, max);
  return count ? (
    <span id={id} className="edit-field__count">
      {count}
    </span>
  ) : null;
}

export function PersonForm({ proposal, person, unavailable, catalogue = null, onSave, onRemove, onClose }: PersonFormProps) {
  const id = useId();
  const [edit, setEdit] = useState<PersonEdit>({ name: person.name, title: person.title, room: person.room, reportsTo: person.reportsTo, model: person.model, owns: person.owns });
  // v0.2: what their desk loads, with every part filled from their level's defaults.
  const [loads, setLoads] = useState(() => loadsOf(person));
  const managers = managerChoices(proposal, person.id);
  const ceo = person.level === 'ceo';
  const changed =
    edit.name !== person.name || edit.title !== person.title || edit.room !== person.room || edit.reportsTo !== person.reportsTo || edit.model !== person.model || edit.owns !== person.owns || !sameResolved(loads, loadsOf(person));
  // Each field holds what the office takes, so a save isn't turned down for length; the count shows near the end.
  const counted = (field: 'name' | 'title' | 'owns', max: number) => (fieldCount(edit[field], max) ? `${id}-${field}-count` : undefined);
  return (
    <form
      className="edit-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!unavailable && changed) onSave({ ...edit, loads: loadsToWrite(loads, person.level) });
      }}
    >
      <h3 id={`${id}-title`} className="edit-form__title" tabIndex={-1} data-panel-heading>
        {named(person)}
      </h3>
      {/* A div, not a wrapping label, so the count describes the field instead of joining its name. */}
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <input
          id={`${id}-name`}
          className="text-input"
          value={edit.name}
          maxLength={NAME_MAX}
          autoComplete="off"
          aria-describedby={counted('name', NAME_MAX)}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
        />
        <Counted id={`${id}-name-count`} text={edit.name} max={NAME_MAX} />
      </div>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-title-field`}>
          Title
        </label>
        <input
          id={`${id}-title-field`}
          className="text-input"
          value={edit.title}
          maxLength={PROPOSAL_LIMITS.title}
          autoComplete="off"
          aria-describedby={counted('title', PROPOSAL_LIMITS.title)}
          onChange={(e) => setEdit({ ...edit, title: e.target.value })}
        />
        <Counted id={`${id}-title-count`} text={edit.title} max={PROPOSAL_LIMITS.title} />
      </div>
      {!ceo && (
        <>
          <label className="edit-field">
            <span className="edit-field__label">Room</span>
            <select className="select-input" value={edit.room} onChange={(e) => setEdit({ ...edit, room: e.target.value })}>
              {proposal.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <label className="edit-field">
            <span className="edit-field__label">Reports to</span>
            <select className="select-input" value={edit.reportsTo ?? ''} onChange={(e) => setEdit({ ...edit, reportsTo: e.target.value || null })}>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {named(m)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="edit-field">
        <span className="edit-field__label">Model</span>
        <select className="select-input" value={edit.model} onChange={(e) => isModel(e.target.value) && setEdit({ ...edit, model: e.target.value })}>
          {ROLE_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_NAMES[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-owns`}>
          What they own
        </label>
        <textarea
          id={`${id}-owns`}
          className="prose-input"
          rows={2}
          maxLength={PROPOSAL_LIMITS.owns}
          value={edit.owns}
          aria-describedby={counted('owns', PROPOSAL_LIMITS.owns)}
          onChange={(e) => setEdit({ ...edit, owns: e.target.value })}
        />
        <Counted id={`${id}-owns-count`} text={edit.owns} max={PROPOSAL_LIMITS.owns} />
      </div>
      <LoadsFields level={person.level} value={loads} onChange={setLoads} servers={mcpNamed(proposal.people)} catalogue={catalogue} kind={person.level === 'worker' ? 'workers' : 'the CEO and managers'} />
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={!changed || unavailable !== null || undefined}>
          Save changes
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {unavailable && <p className="edit-form__why">{unavailable}</p>}
      {!ceo && (
        <button type="button" className="link link--danger edit-form__remove" aria-disabled={unavailable !== null || undefined} onClick={() => !unavailable && onRemove()}>
          Take out of the proposal
        </button>
      )}
    </form>
  );
}

interface AddPersonFormProps {
  proposal: OrgProposal;
  room: string;
  catalogue: Catalogue;
  unavailable: string | null;
  onAdd: (input: { name: string; title: string; model: RoleModel; owns: string; library: string | null }) => void;
  onDescribe: (description: string) => void;
  /** Reads the library again after it couldn't be read. */
  onRetry: () => void;
  onClose: () => void;
}

export function AddPersonForm({ proposal, room, catalogue, unavailable, onAdd, onDescribe, onRetry, onClose }: AddPersonFormProps) {
  const id = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const roomTitle = proposal.rooms.find((r) => r.id === room)?.title ?? room;
  const style = proposal.rooms.find((r) => r.id === room)?.style;
  const read = catalogue.state === 'read' ? catalogue.roles : null;
  const roles = [...(read ?? [])].sort((a, b) => Number(b.department === style) - Number(a.department === style) || a.title.localeCompare(b.title));
  // Until a choice is made, the library is the way in unless it was read with nothing in it; then describing is.
  const [chosen, setMode] = useState<'library' | 'describe' | null>(null);
  const empty = read !== null && roles.length === 0;
  const mode = chosen ?? (empty ? 'describe' : 'library');
  const [picked, setRoleId] = useState<string | null>(null);
  const roleId = picked ?? roles[0]?.id ?? '';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const role = roles.find((r) => r.id === roleId);
  return (
    <form
      className="edit-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (unavailable) return;
        if (mode === 'describe') {
          if (description.trim()) onDescribe(description.trim());
          else setProblem('Say what the role does.');
          return;
        }
        // Still being read, or it couldn't be: the line in its place says which.
        if (read === null) return;
        if (!role) setProblem('Pick a role.');
        else if (!name.trim()) setProblem('Give them a first name.');
        else onAdd({ name, title: role.title, model: isModel(role.model) ? role.model : 'sonnet', owns: ownsOf(role.description), library: role.id });
      }}
    >
      <h3 ref={title} id={`${id}-title`} className="edit-form__title" tabIndex={-1} data-panel-heading>
        Add someone to {roomTitle}
      </h3>
      <Segmented
        label="How to add them"
        options={[
          { value: 'library', label: 'A library role', disabled: empty },
          { value: 'describe', label: 'Describe a role' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'library' && catalogue.state === 'reading' ? (
        <p className="edit-form__hint" role="status">
          Reading the library…
        </p>
      ) : mode === 'library' && catalogue.state === 'failed' ? (
        <>
          <p className="edit-form__problem" role="alert">
            {libraryProblem(catalogue.problem)}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              // The button goes while the library is read again: focus waits on the form's title.
              title.current?.focus();
              onRetry();
            }}
          >
            Try again
          </button>
        </>
      ) : mode === 'library' ? (
        <>
          <label className="edit-field">
            <span className="edit-field__label">Role</span>
            <select className="select-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          {role && <p className="edit-form__hint">{role.description}</p>}
          <label className="edit-field">
            <span className="edit-field__label">First name</span>
            <input className="text-input" value={name} maxLength={40} autoComplete="off" onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }} />
          </label>
        </>
      ) : (
        <label className="edit-field">
          <span className="edit-field__label">What the role does</span>
          <textarea
            className="prose-input"
            rows={3}
            maxLength={1000}
            value={description}
            placeholder="A Swiss privacy specialist who checks the data we keep."
            onChange={(e) => {
              setDescription(e.target.value);
              setProblem(null);
            }}
          />
          <span className="edit-form__hint">The CEO writes the role to the library's bar and adds it to the proposal.</span>
        </label>
      )}
      {problem && <p className="edit-form__problem">{problem}</p>}
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={unavailable !== null || (mode === 'library' && read === null) || undefined}>
          {mode === 'library' ? 'Add them' : 'Ask the CEO'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {unavailable && <p className="edit-form__why">{unavailable}</p>}
    </form>
  );
}

export function AddRoomForm({ unavailable, onAdd, onClose }: { unavailable: string | null; onAdd: (input: { title: string; style: BaseDepartment }) => void; onClose: () => void }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<BaseDepartment>('engineering');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="edit-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (unavailable) return;
        if (title.trim()) onAdd({ title, style });
        else setProblem('Name the room.');
      }}
    >
      <h3 id={`${id}-title`} className="edit-form__title" tabIndex={-1} data-panel-heading>
        Add a room
      </h3>
      <label className="edit-field">
        <span className="edit-field__label">Name</span>
        <input className="text-input" value={title} maxLength={40} autoComplete="off" onChange={(e) => {
            setTitle(e.target.value);
            setProblem(null);
          }} />
      </label>
      <label className="edit-field">
        <span className="edit-field__label">Looks like</span>
        <select className="select-input" value={style} onChange={(e) => isBase(e.target.value) && setStyle(e.target.value)}>
          {BASE_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {BASE_DEPARTMENT_INFO[d].name}
            </option>
          ))}
        </select>
      </label>
      {problem && <p className="edit-form__problem">{problem}</p>}
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={unavailable !== null || undefined}>
          Add the room
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {unavailable && <p className="edit-form__why">{unavailable}</p>}
    </form>
  );
}
