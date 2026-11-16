// The ID badge of whoever is selected: what the role is, what it is doing, what it has cost, and the levers.
import { useEffect, useRef, useState } from 'react';
import { nameInSentence, severalLeads } from '../../../src/core/words.ts';
import { goalOf, mostUrgent, personRow, plainText } from '../../../src/core/now.ts';
import { capital } from '../../../src/core/words.ts';
import { type AgentState, agentCost, usesReported } from '../../../src/core/office.ts';
import { modelLabel } from '../../../src/core/pricing.ts';
import { inSentence, ROLE_MODELS, type RoleModel, type Studio, type StudioRole } from '../../../src/core/studio.ts';
import type { ReshapeAction, Snapshot, StudioCatalog } from '../../../src/core/snapshot.ts';
import { addUsage, ZERO_USAGE } from '../../../src/core/usage.ts';
import type { Selection } from '../scene/Building.tsx';
import { ago, dollars, tokens } from '../lib/format.ts';
import { Confirm } from './Confirm.tsx';
import { Story } from './Story.tsx';
import { type TalkTarget, targetOf } from './asideModel.ts';
import { agentsOfRole, roomHue, STATE_TEXT, STATE_TONE } from './model.ts';

const isRoleModel = (m: string): m is RoleModel => (ROLE_MODELS as readonly string[]).includes(m);
const modelName = (m: string) => (m === 'inherit' ? 'Same as the session' : isRoleModel(m) ? m.charAt(0).toUpperCase() + m.slice(1) : modelLabel(m));
/** What an agent or the person wrote, as the badge shows it: without Markdown's code and emphasis marks. */
const shown = (text: string | null | undefined): string | null => (text ? plainText(text) : null);

interface Props {
  snapshot: Snapshot;
  catalog: StudioCatalog | null;
  selection: Exclude<Selection, null | { kind: 'room' }>;
  canChange: string | null;
  onSelect: (s: Selection) => void;
  onBack: () => void;
  onReshape: (action: ReshapeAction) => Promise<boolean>;
  /** The office's clock (a replay's position in a replay). */
  now: number;
  /** Opens the conversation with this person (Ask aside), from the button pressed: focus goes back to it on close. */
  onAsk?: (target: TalkTarget, opener: HTMLElement) => void;
}

function Stats({ agents }: { agents: AgentState[] }) {
  const usage = agents.reduce((u, a) => addUsage(u, a.usage), ZERO_USAGE);
  const cost = agents.reduce((s, a) => s + agentCost(a), 0);
  const requests = agents.reduce((s, a) => s + a.requests, 0);
  const calls = agents.reduce((s, a) => s + a.toolCalls, 0);
  const errors = agents.reduce((s, a) => s + a.toolErrors, 0);
  const models = [...new Set(agents.flatMap((a) => Object.keys(a.models)))].map(modelLabel);
  const files = [...new Set(agents.flatMap((a) => a.files))];
  const exact = agents.some((a) => a.requests > 0) && agents.every((a) => a.requests === 0 || usesReported(a));
  return (
    <>
      <dl className="stats">
        <div><dt>{exact ? 'Spend' : 'API-equivalent'}</dt><dd>{dollars(cost)}</dd></div>
        <div><dt>Input</dt><dd>{tokens(usage.input)}</dd></div>
        <div><dt>Output</dt><dd>{tokens(usage.output)}</dd></div>
        <div><dt>Cache read</dt><dd>{tokens(usage.cacheRead)}</dd></div>
        <div><dt>Cache write</dt><dd>{tokens(usage.cacheWrite5m + usage.cacheWrite1h)}</dd></div>
        <div><dt>API requests</dt><dd>{requests}</dd></div>
        <div><dt>Tool calls</dt><dd>{calls}{errors > 0 && <span className="stats__bad"> ({errors} failed)</span>}</dd></div>
        <div><dt>Model</dt><dd>{models.length > 0 ? models.join(', ') : 'None yet'}</dd></div>
      </dl>
      {files.length > 0 && (
        <details className="files">
          <summary>{files.length} {files.length === 1 ? 'file' : 'files'} changed</summary>
          <ul>{files.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </details>
      )}
    </>
  );
}

interface LeversProps {
  role: StudioRole;
  studio: Studio;
  /** The model in the agent file: an alias, `inherit`, or a full model id someone wrote by hand. */
  model: string;
  file: string | undefined;
  canChange: string | null;
  onReshape: (action: ReshapeAction) => Promise<boolean>;
  onFired: () => void;
}

/**
 * Model, room and fire. Picking from a list only drafts the change (arrowing through a closed select fires a change
 * per key in some browsers); Save writes it.
 */
function Levers({ role, studio, model, file, canChange, onReshape, onFired }: LeversProps) {
  const [nextModel, setNextModel] = useState(model);
  const [nextRoom, setNextRoom] = useState(role.department);
  const [saving, setSaving] = useState(false);
  const [confirmFire, setConfirmFire] = useState(false);
  const modelChanged = nextModel !== model;
  const roomChanged = nextRoom !== role.department;
  const models: string[] = isRoleModel(model) ? [...ROLE_MODELS] : [model, ...ROLE_MODELS];
  const save = async () => {
    setSaving(true);
    // The room only moves if the model change went through: a failure stops here with both drafts still showing.
    const modelSaved = modelChanged && isRoleModel(nextModel) ? await onReshape({ action: 'model', role: role.id, model: nextModel }) : true;
    if (modelSaved && roomChanged) await onReshape({ action: 'move', role: role.id, department: nextRoom });
    setSaving(false);
  };
  const where = [modelChanged ? (file ?? 'the agent file') : null, roomChanged ? '.claude/studio.yaml' : null].filter(Boolean).join(' and ');
  const busy = Boolean(canChange) || saving;
  return (
    <section className="levers" aria-label="Change this role">
      {canChange ? <p className="note">{canChange}</p> : null}
      <div className="field">
        <label className="field__label" htmlFor="role-model">Model</label>
        <select id="role-model" value={nextModel} disabled={busy} onChange={(e) => setNextModel(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m} disabled={!isRoleModel(m)}>
              {modelName(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="role-room">Room</label>
        <select id="role-room" value={nextRoom} disabled={busy} onChange={(e) => setNextRoom(e.target.value)}>
          {studio.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      {(modelChanged || roomChanged) && (
        <div className="levers__save">
          <p className="muted">Save writes {where}. Sessions started after that use it.</p>
          <div className="levers__buttons">
            <button type="button" className="button button--primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving' : 'Save changes'}
            </button>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => {
                setNextModel(model);
                setNextRoom(role.department);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <button type="button" className="button button--danger" disabled={busy} onClick={() => setConfirmFire(true)}>Fire</button>
      {file && <p className="muted">Defined in <code>{file}</code></p>}
      <Confirm
        open={confirmFire}
        title={`Fire the ${inSentence(role.title)}?`}
        body="Its agent file moves to .claude/studio/fired/, so Claude Code stops delegating to it. You can rehire it from its room."
        confirmLabel="Fire"
        danger
        onCancel={() => setConfirmFire(false)}
        onConfirm={() => {
          setConfirmFire(false);
          void onReshape({ action: 'fire', role: role.id }).then((ok) => ok && onFired());
        }}
      />
    </section>
  );
}

export function PersonCard({ snapshot, catalog, selection, canChange, onSelect, onBack, onReshape, now, onAsk }: Props) {
  const studio = snapshot.studio;
  const roleId = selection.kind === 'role' ? selection.id : snapshot.agents.find((a) => a.key === selection.key)?.roleId ?? null;
  const role = roleId ? studio?.roles.find((r) => r.id === roleId) : undefined;
  const single = selection.kind === 'agent' ? snapshot.agents.find((a) => a.key === selection.key) : undefined;
  const agents = role && selection.kind === 'role' ? agentsOfRole(snapshot, role.id) : single ? [single] : [];
  const latest = agents[0];
  // The call the badge speaks for: the person's own, or the role's most urgent.
  const urgent = mostUrgent(agents, now);
  const row = urgent ? personRow(snapshot, urgent.agent, now) : null;
  const word = urgent?.state.kind ?? 'off';
  const goal = shown(urgent ? goalOf(urgent.agent) : null);
  const request = shown(urgent?.agent.agentId ? urgent.agent.purpose : null);
  const result = shown(
    !urgent || !row ? null
      : urgent.state.kind === 'stuck' ? urgent.state.error
      : urgent.state.kind === 'done' ? urgent.state.result
      : urgent.state.kind === 'has-question' && row.result ? urgent.agent.lastMessage
      : null,
  );
  const hue = role ? roomHue(snapshot, role.department) : single?.kind === 'lead' ? '#C9B458' : '#8C948F';
  const department = role ? studio?.departments.find((d) => d.id === role.department) : undefined;
  const definition = catalog?.agents.find((a) => a.id === (role?.id ?? single?.agentType));
  const title = role?.title ?? row?.name ?? single?.name ?? 'Lead';
  const session = single?.kind === 'lead' ? snapshot.sessions.find((s) => s.id === single.sessionId) : undefined;
  const lastPrompt = shown(session?.lastPrompt);
  const hireable = !role && single?.kind === 'contractor' ? catalog?.library.find((r) => r.id === single.agentType) : undefined;
  const keys = new Set(agents.map((a) => a.key));

  // The badge takes the place of whatever opened it, so focus moves to its title instead of dropping to the page.
  const heading = useRef<HTMLHeadingElement>(null);
  const opened = selection.kind === 'role' ? `role:${selection.id}` : `agent:${selection.key}`;
  useEffect(() => heading.current?.focus({ preventScroll: true }), [opened]);

  return (
    <article className="badge" style={{ ['--hue' as string]: hue }} aria-labelledby="badge-title">
      <header className="badge__band">
        <button type="button" className="badge__back" onClick={onBack}>Back</button>
        <h2 id="badge-title" className="badge__title" tabIndex={-1} ref={heading}>{title}</h2>
        <p className="badge__room">
          {department ? (
            <button type="button" className="link link--on-band" onClick={() => onSelect({ kind: 'room', id: department.id })}>{department.name}</button>
          ) : single?.kind === 'lead' ? 'The main Claude Code session' : 'Contractor: no role in this studio'}
        </p>
      </header>

      <section className="badge__now">
        <span className={`pill status--${STATE_TONE[word]}`}>{STATE_TEXT[word]}</span>
        {goal && <p className="badge__doing">{goal}</p>}
        {request && <p className="badge__request">For your request: {request}</p>}
        {row && <p className={`badge__status status--${STATE_TONE[word]}`}>{row.status}</p>}
        {result && <p className={word === 'stuck' ? 'badge__error' : 'badge__result'}>{capital(result)}</p>}
        {row && row.facts.length > 0 && <p className="muted">{row.facts.map((f) => `${f}.`).join(' ')}</p>}
        {lastPrompt && lastPrompt !== goal && <p className="badge__task"><span className="muted">Your last message:</span> {lastPrompt}</p>}
        {latest && <p className="muted">Last seen {ago(latest.lastEventAt, now)}{agents.length > 1 ? `, called ${agents.length} times` : ''}</p>}
        {!latest && role && <p className="muted">Hasn't been called yet in the sessions the office has seen.</p>}
        {onAsk && (
          <button
            type="button"
            className="button badge__ask"
            data-ask="badge"
            onClick={(e) => onAsk(role ? { roleId: role.id, agentKey: single?.key ?? null } : single ? targetOf(single) : { roleId: null, agentKey: selection.kind === 'agent' ? selection.key : null }, e.currentTarget)}
          >
            Ask {role ? nameInSentence({ kind: 'role', name: role.title, agentType: role.id, sessionId: '' }) : single ? nameInSentence(single, severalLeads(snapshot.agents)) : 'the lead'}
          </button>
        )}
      </section>

      {agents.length > 0 && <Stats agents={agents} />}

      {(definition?.description ?? hireable?.description) && <p className="badge__description">{definition?.description ?? hireable?.description}</p>}

      {role && studio && (
        // Keyed by what is saved, so a saved change (or an edit made outside the office) starts the drafts afresh.
        <Levers
          key={`${role.id}:${definition?.model ?? 'inherit'}:${role.department}`}
          role={role}
          studio={studio}
          model={definition?.model ?? 'inherit'}
          file={definition?.file}
          canChange={canChange}
          onReshape={onReshape}
          onFired={() => onSelect({ kind: 'room', id: role.department })}
        />
      )}

      {hireable && (
        <section className="levers">
          <p className="note">The library has a {inSentence(hireable.title)} role. Hire it to give this work a desk and its own rules.</p>
          <button type="button" className="button button--primary" disabled={Boolean(canChange)} onClick={() => void onReshape({ action: 'hire', role: hireable.id })}>Hire {inSentence(hireable.title)}</button>
        </section>
      )}

      {agents.length > 0 && (
        <section aria-labelledby="badge-log">
          <h3 id="badge-log" className="group-title">Recent work</h3>
          <Story snapshot={snapshot} onSelect={onSelect} people={keys} />
        </section>
      )}
    </article>
  );
}
