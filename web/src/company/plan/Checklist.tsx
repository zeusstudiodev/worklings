// The checklist on the plan (SPEC-v0.2.md, "Simple, visible, proven", 3): what you asked for, each thing as a sentence the
// final review checks, quoting your words, with the tasks that cover it. On the latest version you change it as you change
// the plan: edit an item's sentence and what covers it, add one of your own, or remove one, each with Undo in place and
// saved with the plan. Your words stay as you wrote them. An item no task covers says so; the office doesn't refuse your
// edit over it, it tells the CEO.
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CHECKLIST_LIMITS, type ChecklistItem, type Plan } from '../../../../src/core/steering.ts';
import { UndoLine } from '../ui/UndoLine.tsx';
import type { LastChange, Where } from './PlanBody.tsx';
import { type ItemFields, named, type PlanOp } from './planEdit.ts';

interface ChecklistProps {
  plan: Plan;
  editable: boolean;
  onChange: (op: PlanOp, where: Where, focusUndo: boolean) => void;
  last: LastChange | null;
  onUndoLast: () => void;
  undoRef: Ref<HTMLButtonElement>;
  newItemId: () => string;
}

type Editing = { kind: 'item'; id: string } | { kind: 'add' } | null;

function focusKey(key: string) {
  document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}

export function Checklist({ plan, editable, onChange, last, onUndoLast, undoRef, newItemId }: ChecklistProps) {
  const id = useId();
  const [editing, setEditing] = useState<Editing>(null);
  const items = plan.checklist ?? [];
  const full = items.length >= CHECKLIST_LIMITS.items;
  const title = (task: string) => plan.tasks.find((t) => t.id === task)?.title ?? 'A task no longer in the plan';

  const close = (back: string) => {
    flushSync(() => setEditing(null));
    focusKey(back);
  };
  const save = (op: PlanOp, where: Where) => {
    flushSync(() => setEditing(null));
    onChange(op, where, true);
  };
  const undoAt = (where: Where) =>
    last && last.where.kind === where.kind && JSON.stringify(last.where) === JSON.stringify(where) ? <UndoLine ref={undoRef} text={last.text} until={last.until} onUndo={onUndoLast} /> : null;

  return (
    <section className="plan-section plan-checklist" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="group-title" tabIndex={-1} data-focus="plan-checklist">
        The checklist
      </h3>
      <p className="group-note">
        {items.length === 0
          ? 'No checklist in this version. The final review checks the work against each thing you asked for, so add what matters to you.'
          : `What you asked for, as ${items.length === 1 ? 'one sentence' : `${items.length} sentences`} the final review checks, each with the tasks that build it.`}
      </p>
      {items.length > 0 && (
        <ol className="plan-checklist__items">
          {items.map((k, i) => {
            const where: Where = { kind: 'item', id: k.id };
            const isEditing = editing?.kind === 'item' && editing.id === k.id;
            const goneHere = last?.where.kind === 'gone-item' && last.where.before === k.id ? undoAt(last.where) : null;
            return (
              <li key={k.id} className="plan-check" data-undo-item>
                {goneHere && <div className="plan-check__gone">{goneHere}</div>}
                <p className="plan-check__text" tabIndex={-1} data-focus={`plan-item:${k.id}`}>
                  <span className="plan-check__number" aria-hidden="true">
                    {i + 1}
                  </span>
                  {k.text}
                </p>
                {k.quote && (
                  <p className="check__quote plan-check__quote">
                    <span className="visually-hidden">Your words: </span>“{k.quote}”
                  </p>
                )}
                {k.covers.length > 0 ? (
                  <p className="plan-task__meta plan-check__covers">
                    <span className="plan-task__key">Covered by</span> {k.covers.map((c) => `“${title(c)}”`).join(', ')}
                  </p>
                ) : (
                  <p className="check__none plan-check__covers">No task covers this yet.</p>
                )}
                {editable && !isEditing && (
                  <div className="plan-task__actions">
                    <button type="button" className="link" data-focus={`plan-item-edit:${k.id}`} onClick={() => setEditing({ kind: 'item', id: k.id })}>
                      Edit<span className="visually-hidden"> {k.text}</span>
                    </button>
                    <button
                      type="button"
                      className="link link--danger"
                      onClick={() => onChange({ op: 'cut-item', id: k.id, name: k.text }, { kind: 'gone-item', before: items[i + 1]?.id ?? null }, true)}
                    >
                      Remove<span className="visually-hidden"> {k.text}</span>
                    </button>
                  </div>
                )}
                {isEditing && (
                  <ItemForm
                    plan={plan}
                    item={k}
                    adding={false}
                    onSave={(set) => save({ op: 'edit-item', id: k.id, name: k.text, set }, where)}
                    onClose={() => close(`plan-item-edit:${k.id}`)}
                  />
                )}
                {undoAt(where)}
              </li>
            );
          })}
        </ol>
      )}
      {last?.where.kind === 'gone-item' && last.where.before === null && <div className="plan-check__gone">{undoAt(last.where)}</div>}
      {editable && editing?.kind !== 'add' && (
        <button type="button" className="link plan-link" aria-disabled={full || undefined} data-focus="plan-checklist-add" onClick={() => !full && setEditing({ kind: 'add' })}>
          Add something you asked for
        </button>
      )}
      {editable && full && <p className="plan-note">The checklist holds {CHECKLIST_LIMITS.items} items. Remove one to add another.</p>}
      {editing?.kind === 'add' && (
        <ItemForm
          plan={plan}
          item={{ id: '', text: '', quote: null, covers: [] }}
          adding
          onSave={(fields) => {
            const item: ChecklistItem = { id: newItemId(), quote: null, ...fields };
            save({ op: 'add-item', item, before: null }, { kind: 'item', id: item.id });
          }}
          onClose={() => close('plan-checklist-add')}
        />
      )}
    </section>
  );
}

/** Changing an item, or adding one: its sentence, and the tasks that cover it picked from the plan. */
function ItemForm({ plan, item, adding, onSave, onClose }: { plan: Plan; item: ChecklistItem; adding: boolean; onSave: (fields: ItemFields) => void; onClose: () => void }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [text, setText] = useState(item.text);
  const [covers, setCovers] = useState<string[]>(item.covers);
  const [pick, setPick] = useState('');
  const [tried, setTried] = useState(false);
  const empty = !text.trim();
  const choices = plan.tasks.filter((t) => !covers.includes(t.id) && t.kind !== 'verification');
  const title = (task: string) => plan.tasks.find((t) => t.id === task)?.title ?? 'A task no longer in the plan';
  return (
    <form
      className="edit-form plan-form"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (empty) {
          document.getElementById(`${id}-text`)?.focus();
          return;
        }
        const fields = { text: text.trim(), covers };
        if (adding || fields.text !== item.text || JSON.stringify(covers) !== JSON.stringify(item.covers)) onSave(fields);
        else onClose();
      }}
    >
      <h4 id={`${id}-heading`} className="edit-form__title" tabIndex={-1} ref={heading}>
        {adding ? 'Add something you asked for' : `Change ${named(item.text)}`}
      </h4>
      <div className="edit-field">
        <label className="edit-field__label" htmlFor={`${id}-text`}>
          What should be true when it is done
        </label>
        <textarea
          id={`${id}-text`}
          className="prose-input"
          rows={2}
          maxLength={CHECKLIST_LIMITS.text}
          value={text}
          aria-invalid={tried && empty ? true : undefined}
          aria-describedby={tried && empty ? `${id}-why` : `${id}-hint`}
          onChange={(e) => setText(e.target.value)}
        />
        <span id={`${id}-hint`} className="edit-form__hint">
          One short sentence someone can check, like “Guests can pay with TWINT.”
        </span>
        {tried && empty && (
          <span id={`${id}-why`} className="edit-form__problem">
            Say what you want to be true.
          </span>
        )}
      </div>
      {item.quote && (
        <p className="edit-form__hint">
          Your words, as you wrote them: <span className="check__quote">“{item.quote}”</span>
        </p>
      )}
      <fieldset className="plan-form__waits">
        <legend className="edit-field__label">Covered by</legend>
        {covers.length === 0 ? (
          <p className="edit-form__hint">No task yet. It can stay that way; the CEO hears that nothing covers it.</p>
        ) : (
          <ul className="plan-form__wait-list">
            {covers.map((c) => (
              <li key={c}>
                <span>{title(c)}</span>
                <button type="button" className="link" onClick={() => setCovers(covers.filter((x) => x !== c))}>
                  Remove<span className="visually-hidden"> {title(c)} from what covers it</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {choices.length > 0 && covers.length < CHECKLIST_LIMITS.covers && (
          <div className="plan-form__wait-add">
            <label className="visually-hidden" htmlFor={`${id}-pick`}>
              A task that covers it
            </label>
            <select id={`${id}-pick`} className="select-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Pick a task…</option>
              {plan.milestones.map((m) => {
                const list = choices.filter((t) => t.milestone === m.id);
                return list.length === 0 ? null : (
                  <optgroup key={m.id} label={m.title}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <button
              type="button"
              className="button"
              aria-disabled={!pick || undefined}
              onClick={() => {
                if (!pick) return;
                setCovers([...covers, pick]);
                setPick('');
              }}
            >
              Add
            </button>
          </div>
        )}
      </fieldset>
      <div className="edit-form__actions">
        <button type="submit" className="button button--primary">
          {adding ? 'Add it' : 'Save changes'}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}
