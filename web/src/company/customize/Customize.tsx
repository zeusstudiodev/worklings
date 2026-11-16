// Customize the office (docs/design-v3.md, "Customize and Settings"): say it to the office manager, or change it
// directly: the theme, the rooms, the decor and people's looks. Each direct change applies at once with "Changed. Undo"
// in place for 10 s; a refusal shows under its control.
import { type CSSProperties, type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import type { OfficeChange } from '../../../../src/core/company.ts';
import type { BaseDepartment } from '../../../../src/core/departments.ts';
import { LOOK_BODIES, LOOK_PROPS, type LookBody, type LookProp, MAX_DECOR, ROOM_KINDS, type RoomKind, THEMES, type Theme } from '../../../../src/core/looks.ts';
import { inSentence, type Look, slugId, titleFromId } from '../../../../src/core/studio.ts';
import { DEPARTMENT_HUE } from '../../scene/palette.ts';
import { THEME_NAMES } from '../proposal/model.ts';
import type { TabProps } from '../types.ts';
import { THEME_SWATCH } from '../ui/ThemeStill.tsx';
import { UndoLine } from '../ui/UndoLine.tsx';

const UNDO_SHOWN_MS = 10_000;
/** When Undo goes, for a change made now (called from handlers, never while drawing). */
const undoUntil = () => Date.now() + UNDO_SHOWN_MS;

const KIND_NAMES: Record<RoomKind, string> = { meeting: 'Meeting room', ceo: "The CEO's office", reception: 'Reception', lounge: 'Lounge', games: 'Games room', kitchen: 'Kitchen' };
/** The kinds "Add a room" offers: the CEO's office and reception come with every office. */
const ADDABLE: RoomKind[] = ROOM_KINDS.filter((k): k is RoomKind => k !== 'ceo' && k !== 'reception');

const BODY_NAMES: Record<LookBody, string> = { mannequin: 'Plain', knight: 'Sturdy', barbarian: 'Broad', mage: 'Tall', rogue: 'Slight', ranger: 'Lean' };
const PROP_NAMES: Record<LookProp, string> = { none: 'None', headset: 'Headset', laptop: 'Laptop', clipboard: 'Clipboard', tablet: 'Tablet', notebook: 'Notebook' };
/** The office's skin tones, light to dark, as the scene draws them (web/src/scene/palette.ts). */
const SKIN_SWATCHES = ['#F2D3B8', '#E8B996', '#D19A73', '#A9714B', '#7B4E32', '#5A3826'];
const HAIR_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Black', hex: '#2b2420' }, { name: 'Dark brown', hex: '#4a3424' }, { name: 'Brown', hex: '#7a5232' }, { name: 'Light brown', hex: '#b8854f' },
  { name: 'Blond', hex: '#d9c27a' }, { name: 'Grey', hex: '#8b8f96' }, { name: 'Red', hex: '#a8423a' }, { name: 'Blue-black', hex: '#1f2b3d' },
];
const OUTFIT_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Charcoal', hex: '#3b3f45' }, { name: 'Navy', hex: '#2d3e5c' }, { name: 'Olive', hex: '#5c6b3a' }, { name: 'Burgundy', hex: '#6e2f3a' }, { name: 'Sand', hex: '#c8b48c' }, { name: 'Chalk', hex: '#f2f0ea' },
];

type Section = 'say' | 'theme' | 'rooms' | 'decor' | 'looks';

interface Done {
  section: Section;
  text: string;
  until: number;
  undo: OfficeChange | null;
}

export function Customize(props: TabProps & { phone: boolean }) {
  const { company, actions, online, snapshot } = props;
  const id = useId();
  const [done, setDone] = useState<Done | null>(null);
  const [problem, setProblem] = useState<{ section: Section; text: string } | null>(null);
  const [busy, setBusy] = useState<Section | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const offline = online ? null : 'The office is reconnecting, so changes wait.';

  const manager = company.people.find((p) => p.id === 'office-manager') ?? company.people.find((p) => p.level === 'ceo');
  const departments = snapshot.studio?.departments ?? [];
  const decor = snapshot.studio?.office?.decor ?? [];

  /** Applies a change; `undo` is the change that puts it back. */
  const change = async (section: Section, what: OfficeChange, undo: OfficeChange | null) => {
    if (!online) return;
    setBusy(section);
    setProblem(null);
    try {
      const result = await actions.changeOffice(what);
      if (!result.ok) {
        setProblem({ section, text: result.message });
        return;
      }
      setDone({ section, text: 'Changed.', until: undoUntil(), undo });
      window.setTimeout(() => undoRef.current?.focus(), 0);
    } catch (error) {
      setProblem({ section, text: error instanceof Error ? error.message : "The office didn't answer. Try again." });
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    if (!done?.undo) return;
    const { section, undo: back } = done;
    setDone(null);
    setBusy(section);
    try {
      const result = await actions.changeOffice(back);
      if (!result.ok) setProblem({ section, text: result.message });
    } catch (error) {
      setProblem({ section, text: error instanceof Error ? error.message : "The office didn't answer. Try again." });
    } finally {
      setBusy(null);
    }
  };

  const feedback = (section: Section) => (
    <>
      {done?.section === section && <UndoLine ref={undoRef} text={done.text} until={done.until} onUndo={() => void undo()} unavailable={!online} />}
      {problem?.section === section && (
        <p className="settings__problem" role="alert">
          {problem.text}
        </p>
      )}
    </>
  );

  return (
    <div className="settings">
      <h2 className="panel-title" tabIndex={-1} data-panel-heading>
        Customize the office
      </h2>
      {offline && <p className="muted">{offline}</p>}

      {manager && <SayIt {...props} to={manager.id} toName={manager.id === 'office-manager' ? 'the office manager' : 'the CEO'} />}

      <fieldset className="settings__group" aria-describedby={busy === 'theme' ? `${id}-loading` : undefined}>
        <legend className="settings__legend">Theme</legend>
        <div className="theme-grid">
          {THEMES.map((theme) => {
            const swatch = THEME_SWATCH[theme];
            return (
              <label key={theme} className="theme-option" style={{ '--floor': swatch.floor, '--accent': swatch.accent } as CSSProperties}>
                <input
                  type="radio"
                  name={`${id}-theme`}
                  value={theme}
                  checked={company.theme === theme}
                  disabled={!online || busy === 'theme'}
                  onChange={() => void change('theme', { change: 'theme', theme }, { change: 'theme', theme: company.theme })}
                />
                <span className="theme-option__swatch" aria-hidden="true" />
                <span className="theme-option__name">{inSentence(THEME_NAMES[theme]).replace(/^./, (c) => c.toUpperCase())}</span>
              </label>
            );
          })}
        </div>
        {busy === 'theme' && (
          <p id={`${id}-loading`} className="settings__note">
            Loading the new look. The office keeps its look until it's ready.
          </p>
        )}
        {feedback('theme')}
      </fieldset>

      <Rooms {...props} departments={departments} busy={busy === 'rooms'} change={(what, back) => void change('rooms', what, back)} feedback={feedback('rooms')} />

      <section className="settings__group" aria-labelledby={`${id}-decor`}>
        <h3 id={`${id}-decor`} className="settings__legend">
          Decor
        </h3>
        <Decor decor={decor} online={online} busy={busy === 'decor'} change={(what, back) => void change('decor', what, back)} />
        {feedback('decor')}
      </section>

      <Looks {...props} busy={busy === 'looks'} change={(what, back) => void change('looks', what, back)} feedback={feedback('looks')} />
      <p className="settings__foot">Changes are written to studio.yaml, so the office looks the same after a restart.</p>
    </div>
  );
}

function SayIt(props: TabProps & { to: string; toName: string }) {
  const { actions, online, to, toName } = props;
  const id = useId();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ sent: boolean; problem: string | null }>({ sent: false, problem: null });
  const box = useRef<HTMLTextAreaElement>(null);
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const words = text.trim();
    if (!words || !online) return;
    actions.say(to, words).then(
      () => {
        setText('');
        setState({ sent: true, problem: null });
      },
      (error: unknown) => setState({ sent: false, problem: `Couldn't send: ${error instanceof Error ? error.message : 'the office turned it down.'}` }),
    );
  };
  const suggestions = ['Make it a café', 'Add a games room with an arcade theme', 'More plants'];
  return (
    <form className="settings__group" onSubmit={send} aria-labelledby={`${id}-say`}>
      <h3 id={`${id}-say`} className="settings__legend">
        Tell {toName}
      </h3>
      <div className="talk__suggestions">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="talk__suggestion"
            onClick={() => {
              setText(s);
              box.current?.focus();
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <label className="visually-hidden" htmlFor={`${id}-box`}>
        What to change in the office
      </label>
      <textarea
        ref={box}
        id={`${id}-box`}
        className="talk__box"
        rows={2}
        maxLength={4000}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState({ sent: false, problem: null });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
        }}
      />
      <div className="talk__foot">
        <p className="talk__hint">{state.sent ? `Sent. ${toName.charAt(0).toUpperCase()}${toName.slice(1)} takes it from here.` : `${toName.charAt(0).toUpperCase()}${toName.slice(1)} changes the office and tells you.`}</p>
        <button type="submit" className="button button--primary" aria-disabled={!online || !text.trim() || undefined}>
          Send
        </button>
      </div>
      {state.problem && <p className="settings__problem">{state.problem}</p>}
    </form>
  );
}

interface RoomsProps extends TabProps {
  departments: { id: string; name: string; style: BaseDepartment; theme?: Theme }[];
  busy: boolean;
  change: (what: OfficeChange, back: OfficeChange | null) => void;
  feedback: ReactNode;
}

function Rooms({ company, departments, online, busy, change, feedback }: RoomsProps) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RoomKind>('lounge');
  const [theme, setTheme] = useState<Theme | ''>('');
  const [problem, setProblem] = useState<string | null>(null);
  const unavailable = !online || busy;
  const themeSelect = (label: string, value: Theme | undefined, onPick: (t: Theme | null) => void) => (
    <select className="select-input room-row__theme" aria-label={label} value={value ?? ''} disabled={unavailable} onChange={(e) => onPick(isTheme(e.target.value) ? e.target.value : null)}>
      <option value="">Same as the office</option>
      {THEMES.map((t) => (
        <option key={t} value={t}>
          {THEME_NAMES[t].replace(/^./, (c) => c.toUpperCase())}
        </option>
      ))}
    </select>
  );
  const extra = company.rooms.filter((r) => r.kind !== 'ceo' && r.kind !== 'reception');
  const fixed = company.rooms.filter((r) => r.kind === 'ceo' || r.kind === 'reception');
  return (
    <section className="settings__group" aria-labelledby={`${id}-rooms`}>
      <h3 id={`${id}-rooms`} className="settings__legend">
        Rooms
      </h3>
      <ul className="room-rows">
        {departments.map((d) => (
          <li key={d.id} className="room-row" style={{ '--hue': DEPARTMENT_HUE[d.style] } as CSSProperties}>
            <span className="room-row__name">{d.name}</span>
            {themeSelect(`Theme for ${d.name}`, d.theme, (t) => change({ change: 'room-theme', room: d.id, theme: t }, { change: 'room-theme', room: d.id, theme: d.theme ?? null }))}
          </li>
        ))}
        {fixed.map((r) => (
          <li key={r.id} className="room-row">
            <span className="room-row__name">{r.title}</span>
            {themeSelect(`Theme for ${r.title}`, r.theme, (t) => change({ change: 'room-theme', room: r.id, theme: t }, { change: 'room-theme', room: r.id, theme: r.theme ?? null }))}
          </li>
        ))}
        {extra.map((r) => (
          <li key={r.id} className="room-row room-row--extra">
            <span className="room-row__name">
              {r.title}
              {r.title !== KIND_NAMES[r.kind] && <span className="room-row__kind">{KIND_NAMES[r.kind]}</span>}
            </span>
            {themeSelect(`Theme for ${r.title}`, r.theme, (t) => change({ change: 'room-theme', room: r.id, theme: t }, { change: 'room-theme', room: r.id, theme: r.theme ?? null }))}
            <button type="button" className="link link--danger" aria-disabled={unavailable || undefined} onClick={() => !unavailable && change({ change: 'remove-room', room: r.id }, { change: 'add-room', room: r })}>
              Remove the room<span className="visually-hidden"> {r.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {feedback}
      {!adding ? (
        <button type="button" className="button" onClick={() => setAdding(true)}>
          Add a room
        </button>
      ) : (
        <form
          className="edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (unavailable) return;
            const title = name.trim();
            const roomId = slugId(title);
            if (!title || !roomId) {
              setProblem('Name the room.');
              return;
            }
            if (company.rooms.some((r) => r.id === roomId) || departments.some((d) => d.id === roomId)) {
              setProblem(`There is a room called ${title} already. Name it something else.`);
              return;
            }
            const room = { id: roomId, title, kind, ...(theme ? { theme } : {}) };
            change({ change: 'add-room', room }, { change: 'remove-room', room: roomId });
            setAdding(false);
            setName('');
            setProblem(null);
          }}
        >
          <label className="edit-field">
            <span className="edit-field__label">Name</span>
            <input className="text-input" value={name} maxLength={40} autoComplete="off" autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="edit-field">
            <span className="edit-field__label">Kind</span>
            <select className="select-input" value={kind} onChange={(e) => isKind(e.target.value) && setKind(e.target.value)}>
              {ADDABLE.map((k) => (
                <option key={k} value={k}>
                  {KIND_NAMES[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="edit-field">
            <span className="edit-field__label">Theme</span>
            <select className="select-input" value={theme} onChange={(e) => setTheme(isTheme(e.target.value) ? e.target.value : '')}>
              <option value="">Same as the office</option>
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {THEME_NAMES[t].replace(/^./, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          </label>
          {problem && <p className="edit-form__problem">{problem}</p>}
          <div className="edit-form__actions">
            <button type="submit" className="button button--primary" aria-disabled={unavailable || undefined}>
              Add the room
            </button>
            <button type="button" className="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const isTheme = (v: string): v is Theme => (THEMES as readonly string[]).includes(v);
const isKind = (v: string): v is RoomKind => (ROOM_KINDS as readonly string[]).includes(v);

function Decor({ decor, online, busy, change }: { decor: string[]; online: boolean; busy: boolean; change: (what: OfficeChange, back: OfficeChange | null) => void }) {
  const id = useId();
  const [piece, setPiece] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const full = decor.length >= MAX_DECOR;
  const unavailable = !online || busy;
  return (
    <>
      {decor.length === 0 ? (
        <p className="settings__note">No decor yet.</p>
      ) : (
        <ul className="decor-list">
          {decor.map((d, i) => (
            <li key={`${d}-${i}`} className="decor-list__item">
              <span>{titleFromId(d)}</span>
              <button type="button" className="link" aria-disabled={unavailable || undefined} onClick={() => !unavailable && change({ change: 'decor', add: [], remove: [d] }, { change: 'decor', add: [d], remove: [] })}>
                Remove<span className="visually-hidden"> {titleFromId(d)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="settings__note">The office holds {MAX_DECOR} pieces. Remove one to add another.</p>
      ) : (
        <form
          className="decor-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (unavailable) return;
            const pieceId = slugId(piece);
            if (!pieceId) {
              setProblem('Name the piece, like plants or a coat rack.');
              return;
            }
            change({ change: 'decor', add: [pieceId], remove: [] }, { change: 'decor', add: [], remove: [pieceId] });
            setPiece('');
            setProblem(null);
          }}
        >
          <label className="edit-field">
            <span className="edit-field__label">Add a piece</span>
            <input id={`${id}-piece`} className="text-input" value={piece} maxLength={60} autoComplete="off" placeholder="plants" onChange={(e) => setPiece(e.target.value)} />
          </label>
          <button type="submit" className="button" aria-disabled={unavailable || !piece.trim() || undefined}>
            Add
          </button>
          <p className="settings__note">The office places it. A piece the theme doesn't have is turned down with what it has.</p>
          {problem && <p className="edit-form__problem">{problem}</p>}
        </form>
      )}
    </>
  );
}

interface LooksProps extends TabProps {
  busy: boolean;
  change: (what: OfficeChange, back: OfficeChange | null) => void;
  feedback: ReactNode;
}

function Looks({ company, snapshot, online, busy, change, feedback }: LooksProps) {
  const id = useId();
  const [personId, setPersonId] = useState(company.people[0]?.id ?? '');
  const person = company.people.find((p) => p.id === personId);
  const [look, setLook] = useState<Look>(person?.look ?? {});
  const [lookOf, setLookOf] = useState(personId);
  // Picking someone else starts from their own look.
  if (lookOf !== personId) {
    setLookOf(personId);
    setLook(person?.look ?? {});
  }
  const style = snapshot.studio?.departments.find((d) => d.id === person?.room)?.style;
  const roomColour = style ? DEPARTMENT_HUE[style] : '#8C948F';
  const unavailable = !online || busy || !person;
  const changed = JSON.stringify(look) !== JSON.stringify(person?.look ?? {});
  const swatches = (name: string, label: string, options: { name: string; hex: string }[], value: string | undefined, onPick: (hex: string | undefined) => void, first?: { name: string; hex: string }) => (
    <fieldset className="swatches">
      <legend className="edit-field__label">{label}</legend>
      {first && (
        <label className="swatch" title={first.name}>
          <input type="radio" name={`${id}-${name}`} checked={value === undefined} onChange={() => onPick(undefined)} />
          <span className="swatch__chip" style={{ background: first.hex }} aria-hidden="true" />
          <span className="visually-hidden">{first.name}</span>
        </label>
      )}
      {options.map((o) => (
        <label key={o.hex} className="swatch" title={o.name}>
          <input type="radio" name={`${id}-${name}`} checked={value?.toLowerCase() === o.hex.toLowerCase()} onChange={() => onPick(o.hex.toLowerCase())} />
          <span className="swatch__chip" style={{ background: o.hex }} aria-hidden="true" />
          <span className="visually-hidden">{o.name}</span>
        </label>
      ))}
    </fieldset>
  );
  const without = <K extends keyof Look>(key: K, value: Look[K] | undefined): Look => {
    const next = { ...look };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  };
  return (
    <section className="settings__group" aria-labelledby={`${id}-looks`}>
      <h3 id={`${id}-looks`} className="settings__legend">
        Looks
      </h3>
      <label className="edit-field">
        <span className="edit-field__label">Person</span>
        <select className="select-input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {company.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name === p.title ? p.title : `${p.name}, ${inSentence(p.title)}`}
            </option>
          ))}
        </select>
      </label>
      {person && (
        <form
          className="looks-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (unavailable || !changed) return;
            change({ change: 'look', person: person.id, look }, { change: 'look', person: person.id, look: person.look });
          }}
        >
          <label className="edit-field">
            <span className="edit-field__label">Body</span>
            <select className="select-input" value={look.body ?? 'mannequin'} onChange={(e) => setLook(without('body', LOOK_BODIES.find((b) => b === e.target.value)))}>
              {LOOK_BODIES.map((b) => (
                <option key={b} value={b}>
                  {BODY_NAMES[b]}
                </option>
              ))}
            </select>
          </label>
          {swatches(
            'skin',
            'Skin',
            SKIN_SWATCHES.map((hex, i) => ({ name: `Tone ${i + 1} of ${SKIN_SWATCHES.length}`, hex })),
            look.skin === undefined ? undefined : SKIN_SWATCHES[look.skin],
            (hex) => setLook(without('skin', hex === undefined ? undefined : SKIN_SWATCHES.findIndex((s) => s.toLowerCase() === hex))),
          )}
          {swatches('hair', 'Hair', HAIR_SWATCHES, look.hair, (hex) => setLook(without('hair', hex)))}
          {swatches('outfit', 'Outfit', OUTFIT_SWATCHES, look.color, (hex) => setLook(without('color', hex)), { name: "Their room's colour", hex: roomColour })}
          <label className="edit-field">
            <span className="edit-field__label">Prop</span>
            <select className="select-input" value={look.prop ?? 'none'} onChange={(e) => setLook(without('prop', LOOK_PROPS.find((p) => p === e.target.value)))}>
              {LOOK_PROPS.map((p) => (
                <option key={p} value={p}>
                  {PROP_NAMES[p]}
                </option>
              ))}
            </select>
          </label>
          <div className="edit-form__actions">
            <button type="submit" className="button button--primary" aria-disabled={unavailable || !changed || undefined}>
              Save the look
            </button>
          </div>
        </form>
      )}
      {feedback}
    </section>
  );
}
