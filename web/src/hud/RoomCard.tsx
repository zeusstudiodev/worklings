// A room: who works there, the rules on its walls, the gates at its door, and who could be hired.
import { useState } from 'react';
import { mostUrgent } from '../../../src/core/now.ts';
import { type AgentState, agentCost } from '../../../src/core/office.ts';
import type { ReshapeAction, Snapshot, StudioCatalog } from '../../../src/core/snapshot.ts';
import type { Selection } from '../scene/Building.tsx';
import { dollars } from '../lib/format.ts';
import { agentsOfRole, roomHue, STATE_TEXT, STATE_TONE } from './model.ts';

interface Props {
  snapshot: Snapshot;
  catalog: StudioCatalog | null;
  roomId: string;
  focusRule?: string;
  canChange: string | null;
  onSelect: (s: Selection) => void;
  onBack: () => void;
  onReshape: (action: ReshapeAction) => Promise<boolean>;
  /** The office's clock (a replay's position in a replay). */
  now: number;
}

function RuleEditor({ rule, canChange, onSave }: { rule: StudioCatalog['rules'][number]; canChange: string | null; onSave: (body: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.body);
  if (!editing) {
    return (
      <>
        <pre className="rule__body">{rule.body}</pre>
        <button type="button" className="button" disabled={Boolean(canChange)} onClick={() => { setDraft(rule.body); setEditing(true); }}>Edit rule</button>
      </>
    );
  }
  return (
    <form
      className="rule__form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(draft).then((ok) => ok && setEditing(false));
      }}
    >
      <div className="field field--block">
        <label className="field__label" htmlFor={`rule-${rule.id}`}>Rule text for {rule.paths.join(', ') || 'every file'}</label>
        <textarea id={`rule-${rule.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} spellCheck />
      </div>
      <div className="rule__actions">
        <button type="button" className="button" onClick={() => setEditing(false)}>Cancel</button>
        <button type="submit" className="button button--primary">Save rule</button>
      </div>
    </form>
  );
}

export function RoomCard({ snapshot, catalog, roomId, focusRule, canChange, onSelect, onBack, onReshape, now }: Props) {
  const studio = snapshot.studio;
  const room = studio?.departments.find((d) => d.id === roomId);
  if (!studio || !room) {
    return (
      <article className="badge">
        <button type="button" className="badge__back" onClick={onBack}>Back</button>
        <p className="rows__empty">This room is no longer in the studio.</p>
      </article>
    );
  }
  const hue = roomHue(snapshot, room.id);
  const roles = studio.roles.filter((r) => r.department === room.id);
  const ruleIds = new Set(studio.rules.filter((r) => r.department === room.id).map((r) => r.id));
  const rules = catalog?.rules.filter((r) => ruleIds.has(r.id)) ?? [];
  const gatesOut = studio.gates.filter((g) => g.from === room.id);
  const gatesIn = studio.gates.filter((g) => g.to === room.id);
  const hires = catalog?.library.filter((r) => r.department === room.style) ?? [];
  const fired = studio.fired.filter((f) => f.department === room.id);
  const purpose = catalog?.departments[room.style]?.purpose;
  const nameOf = (id: string) => studio.departments.find((d) => d.id === id)?.name ?? id;

  return (
    <article className="badge" style={{ ['--hue' as string]: hue }} aria-labelledby="room-title">
      <header className="badge__band">
        <button type="button" className="badge__back" onClick={onBack}>Back</button>
        <h2 id="room-title" className="badge__title">{room.name}</h2>
        {purpose && <p className="badge__room">{purpose}</p>}
      </header>

      <section aria-labelledby="room-people">
        <h3 id="room-people" className="group-title">People</h3>
        {roles.length === 0 ? (
          <p className="rows__empty">Nobody works here yet.</p>
        ) : (
          <ul className="rows">
            {roles.map((r) => {
              const agents: AgentState[] = agentsOfRole(snapshot, r.id);
              const word = mostUrgent(agents, now)?.state.kind ?? 'off';
              return (
                <li key={r.id}>
                  <button type="button" className="row" onClick={() => onSelect({ kind: 'role', id: r.id })}>
                    <span className="row__marker" style={{ background: hue }} aria-hidden="true" />
                    <span className="row__main">
                      <span className="row__title">{r.title}</span>
                      <span className={`row__status status--${STATE_TONE[word]}`}>{STATE_TEXT[word]}</span>
                    </span>
                    <span className="row__cost">{agents.length > 0 ? dollars(agents.reduce((s, a) => s + agentCost(a), 0)) : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(gatesOut.length > 0 || gatesIn.length > 0) && (
        <section aria-labelledby="room-gates">
          <h3 id="room-gates" className="group-title">Gates</h3>
          <ul className="plain-list">
            {gatesOut.map((g) => <li key={g.id}><code>/{g.id}</code> checks this room's work before it goes to {nameOf(g.to)}</li>)}
            {gatesIn.map((g) => <li key={`in-${g.id}`}><code>/{g.id}</code> checks work arriving from {nameOf(g.from)}</li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="room-rules">
        <h3 id="room-rules" className="group-title">Rules on the wall</h3>
        {ruleIds.size === 0 && <p className="rows__empty">No path-scoped rules for this room.</p>}
        {rules.map((rule) => (
          <details key={rule.id} className="rule" open={rule.id === focusRule}>
            <summary>
              <span className="rule__title">{studio.rules.find((r) => r.id === rule.id)?.title ?? rule.id}</span>
              <span className="rule__paths">{rule.paths.length > 0 ? rule.paths.join(', ') : 'every file'}</span>
            </summary>
            <RuleEditor rule={rule} canChange={canChange} onSave={(body) => onReshape({ action: 'rule', rule: rule.id, body })} />
          </details>
        ))}
      </section>

      <section aria-labelledby="room-hire">
        <h3 id="room-hire" className="group-title">Hire</h3>
        {canChange && <p className="note">{canChange}</p>}
        {fired.length > 0 && (
          <ul className="rows">
            {fired.map((f) => (
              <li key={f.id} className="hire">
                <span className="hire__title">{f.title} <span className="muted">(fired)</span></span>
                <button type="button" className="button" disabled={Boolean(canChange)} onClick={() => void onReshape({ action: 'rehire', role: f.id })}>Rehire</button>
              </li>
            ))}
          </ul>
        )}
        {hires.length === 0 ? (
          <p className="rows__empty">Everyone the library has for this room already works here.</p>
        ) : (
          <ul className="rows">
            {hires.map((r) => (
              <li key={r.id} className="hire">
                <span className="hire__title">{r.title}</span>
                <span className="hire__desc">{r.description}</span>
                <button type="button" className="button" disabled={Boolean(canChange)} onClick={() => void onReshape({ action: 'hire', role: r.id, department: room.id })}>Hire</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
