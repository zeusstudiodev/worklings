// Everyone in the building, room by room: the accessible twin of the 3D view.
import { goalOf, mostUrgent, personState } from '../../../src/core/now.ts';
import { nameOnTeam } from '../../../src/core/words.ts';
import { type AgentState, agentCost } from '../../../src/core/office.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import type { Selection } from '../scene/Building.tsx';
import { dollars } from '../lib/format.ts';
import { agentsOfRole, isActive, roomHue, STATE_TEXT, STATE_TONE, type StateWord } from './model.ts';

/** Which Team row or room heading opened a badge, so Back can put focus on it again. */
export const teamKey = (s: NonNullable<Selection>): string => (s.kind === 'agent' ? `agent:${s.key}` : `${s.kind}:${s.id}`);

/** Focuses the Team row or room heading with that key; false when it isn't on the tab. */
export function focusTeamRow(root: ParentNode, key: string): boolean {
  const target = root.querySelector<HTMLElement>(`[data-team-key="${CSS.escape(key)}"]`);
  target?.focus();
  return Boolean(target);
}

function Row({ hue, title, word, detail, cost, selected, target, onSelect }: {
  hue: string;
  title: string;
  word: StateWord;
  detail: string | null;
  cost: number | null;
  selected: boolean;
  target: NonNullable<Selection>;
  onSelect: (s: Selection) => void;
}) {
  return (
    <li>
      <button type="button" className={`row${selected ? ' is-selected' : ''}`} data-team-key={teamKey(target)} onClick={() => onSelect(target)} aria-pressed={selected}>
        <span className="row__marker" style={{ background: hue }} aria-hidden="true" />
        <span className="row__main">
          <span className="row__title">{title}</span>
          <span className={`row__status status--${STATE_TONE[word]}`}>
            {STATE_TEXT[word]}
            {detail && <span className="row__detail">{detail}</span>}
          </span>
        </span>
        <span className="row__cost">{cost === null ? '' : dollars(cost)}</span>
      </button>
    </li>
  );
}

/** What someone on the job is trying to get done; the step-by-step stays in the log. */
const detailOf = (a: AgentState | undefined) => (a && isActive(a.status) ? goalOf(a) : null);

const LEADS_SHOWN = 3;
const CONTRACTORS_SHOWN = 12;

/** The line under a list that was cut short: nobody disappears without a word. */
function More({ count, noun }: { count: number; noun: string }) {
  if (count <= 0) return null;
  return <li className="rows__more">{count} more {noun}. The payroll counts them all.</li>;
}

export function TeamList({ snapshot, selection, onSelect, now }: { snapshot: Snapshot; selection: Selection; onSelect: (s: Selection) => void; now: number }) {
  const studio = snapshot.studio;
  const leads = snapshot.agents.filter((a) => a.kind === 'lead').sort((a, b) => b.lastEventAt - a.lastEventAt);
  const contractors = snapshot.agents.filter((a) => a.kind === 'contractor').sort((a, b) => b.lastEventAt - a.lastEventAt);
  const isSelected = (s: Selection) => JSON.stringify(s) === JSON.stringify(selection);

  return (
    <div className="team">
      <section aria-labelledby="team-lead">
        <h3 id="team-lead" className="group-title">Lead</h3>
        <ul className="rows">
          {leads.length === 0 ? (
            <li className="rows__empty">No Claude Code session has reported in yet.</li>
          ) : (
            leads.slice(0, LEADS_SHOWN).map((a) => (
              <Row key={a.key} hue="#C9B458" title={nameOnTeam(a, leads.length > 1)} word={personState(a, now).kind}
                detail={detailOf(a)} cost={agentCost(a)} selected={isSelected({ kind: 'agent', key: a.key })} target={{ kind: 'agent', key: a.key }} onSelect={onSelect} />
            ))
          )}
          <More count={leads.length - LEADS_SHOWN} noun={leads.length - LEADS_SHOWN === 1 ? 'session' : 'sessions'} />
        </ul>
      </section>
      {snapshot.tasks.length > 0 && (
        <section aria-labelledby="team-tasks">
          <h3 id="team-tasks" className="group-title">Tasks</h3>
          <p className="group-note">The shared task list of an agent team.</p>
          <ul className="rows">
            {[...snapshot.tasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.createdAt - a.createdAt).map((t) => (
              <li key={`${t.sessionId}:${t.id}`} className={`task task--${t.status}`}>
                <span className="task__title">{t.title}</span>
                <span className="task__meta">{t.status === 'done' ? 'Done' : 'Open'}{t.owner ? `, ${t.owner}` : ', nobody on it yet'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {studio?.departments.map((d) => {
        const roles = studio.roles.filter((r) => r.department === d.id);
        if (roles.length === 0) return null;
        return (
          <section key={d.id} aria-labelledby={`team-${d.id}`}>
            <h3 id={`team-${d.id}`} className="group-title">
              <button type="button" className="group-title__button" data-team-key={teamKey({ kind: 'room', id: d.id })} onClick={() => onSelect({ kind: 'room', id: d.id })}>{d.name}</button>
            </h3>
            <ul className="rows">
              {roles.map((r) => {
                const agents = agentsOfRole(snapshot, r.id);
                const urgent = mostUrgent(agents, now);
                const cost = agents.length > 0 ? agents.reduce((s, a) => s + agentCost(a), 0) : null;
                return (
                  <Row key={r.id} hue={roomHue(snapshot, d.id)} title={r.title} word={urgent?.state.kind ?? 'off'} detail={detailOf(urgent?.agent)} cost={cost}
                    selected={isSelected({ kind: 'role', id: r.id })} target={{ kind: 'role', id: r.id }} onSelect={onSelect} />
                );
              })}
            </ul>
          </section>
        );
      })}
      {contractors.length > 0 && (
        <section aria-labelledby="team-contractors">
          <h3 id="team-contractors" className="group-title">Contractors</h3>
          <p className="group-note">Agents the studio has no role for, such as Claude Code's built-in Explore and Plan.</p>
          <ul className="rows">
            {contractors.slice(0, CONTRACTORS_SHOWN).map((a) => (
              <Row key={a.key} hue="#8C948F" title={nameOnTeam(a)} word={personState(a, now).kind} detail={detailOf(a)} cost={agentCost(a)}
                selected={isSelected({ kind: 'agent', key: a.key })} target={{ kind: 'agent', key: a.key }} onSelect={onSelect} />
            ))}
            <More count={contractors.length - CONTRACTORS_SHOWN} noun={contractors.length - CONTRACTORS_SHOWN === 1 ? 'contractor' : 'contractors'} />
          </ul>
        </section>
      )}
    </div>
  );
}
