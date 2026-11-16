// A person's Details (docs/design-v3.md, "A person"): v2's figures, their model, room and look, how much context they
// have used, their messages with colleagues, their steps (the only place tool calls show), Fire with Undo, and the way
// out to your own Claude Code.
import { useEffect, useId, useRef, useState } from 'react';
import type { PersonView } from '../../../../src/core/company.ts';
import { LOOK_BODIES, LOOK_PROPS, SKIN_TONES } from '../../../../src/core/looks.ts';
import { coarseDuration } from '../../../../src/core/now.ts';
import { agentCost, usesReported } from '../../../../src/core/office.ts';
import { type Look, titleFromId } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';
import { dollars, hourMinute, tokens, whenAt } from '../../lib/format.ts';
import { called } from '../people/peopleModel.ts';
import { CompanyLink, CopyButton, refusalOf } from '../people/shared.tsx';
import type { TabProps } from '../types.ts';
import { PersonSettings } from '../leash/LeashControls.tsx';
import { contextLine, pageLine, folderOf, noFiguresLine, noSessionLine, othersOf, resumeCommand } from './personModel.ts';

interface Props extends Omit<TabProps, 'navigate'> {
  navigate: TabProps['navigate'];
  p: PersonView;
  now: number;
  onBack: () => void;
  /** Fired: the office's sentence for it. The panel takes it from there, with Undo. */
  onFired: (text: string) => void;
}

export function Details({ snapshot, company, companyId, actions, steer, navigate, announce, online, p, now, onBack, onFired }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const name = called(p);
  const agent = p.agentKey ? snapshot.agents.find((a) => a.key === p.agentKey) : undefined;
  const others = othersOf(company, p);
  const context = contextLine(p.desk.context);
  const page = pageLine(p, company.log, hourMinute);
  const [firing, setFiring] = useState(false);
  const [fireNote, setFireNote] = useState<string | null>(null);

  const fire = async () => {
    if (!online || firing) return;
    setFiring(true);
    setFireNote(null);
    try {
      const result = await actions.reshape({ action: 'fire', role: p.id });
      announce(result.message);
      if (result.ok) onFired(result.message);
      else setFireNote(result.message);
    } catch (error) {
      setFireNote(`Couldn't fire ${name}: ${refusalOf(error)}`);
      announce(`Couldn't fire ${name}: ${refusalOf(error)}`);
    } finally {
      setFiring(false);
    }
  };

  return (
    <section className="person-details" aria-labelledby={`details-${p.id}`}>
      <div className="person-details__head">
        <h3 id={`details-${p.id}`} ref={heading} className="person-details__title" tabIndex={-1}>
          Details
        </h3>
        <button type="button" className="link person-details__back" onClick={onBack}>
          Back to the conversation
        </button>
      </div>

      {agent ? (
        <dl className="stats">
          <div>
            <dt>{agent.requests > 0 && usesReported(agent) ? 'Spend' : 'API-equivalent'}</dt>
            <dd>{dollars(agentCost(agent))}</dd>
          </div>
          <div>
            <dt>Input</dt>
            <dd>{tokens(agent.usage.input)}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{tokens(agent.usage.output)}</dd>
          </div>
          <div>
            <dt>Cache read</dt>
            <dd>{tokens(agent.usage.cacheRead)}</dd>
          </div>
          <div>
            <dt>API requests</dt>
            <dd>{agent.requests}</dd>
          </div>
          <div>
            <dt>Tool calls</dt>
            <dd>
              {agent.toolCalls}
              {agent.toolErrors > 0 && <span className="stats__bad"> ({agent.toolErrors} failed)</span>}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">{noFiguresLine(p)}</p>
      )}

      <Levers key={`${p.id}|${p.room}|${JSON.stringify(p.look)}`} snapshot={snapshot} actions={actions} announce={announce} online={online} p={p} companyId={companyId} navigate={navigate} />
      {/* Their model, effort and leash: the one place the model changes, applied at their next desk. */}
      {steer && <PersonSettings snapshot={snapshot} company={company} person={p} steer={steer} online={online} announce={announce} />}

      {context && (
        <div className="person-details__context">
          {p.desk.context !== null && (
            <span className="context-meter" aria-hidden="true">
              <span className="context-meter__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, p.desk.context)) * 100)}%` }} />
            </span>
          )}
          <p className="person-details__context-line">{context}</p>
          {page && <p className="person-details__context-line">{page}</p>}
        </div>
      )}
      {!context && page && <p className="person-details__context">{page}</p>}

      <h4 className="person-details__sub">Messages with others</h4>
      {others.shown.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="others">
          {others.shown.map((m) => (
            <li key={m.id} className="others__row">
              <p className="others__head">
                <span className="others__with">{m.with}</span> <time dateTime={new Date(m.at).toISOString()}>{whenAt(m.at)}</time>
              </p>
              <p className="others__text">{m.text}</p>
            </li>
          ))}
          {others.more > 0 && <li className="rows__more">and {others.more} more</li>}
        </ul>
      )}

      <h4 className="person-details__sub">Steps</h4>
      {agent ? (
        <div className="steps-now">
          <p>{agent.tool ? `Now: ${agent.tool.phrase}, for ${coarseDuration(now - agent.tool.since)}.` : 'Between steps.'}</p>
          {agent.skill && <p>Working through the {agent.skill} skill.</p>}
          <p>
            {agent.toolCalls} tool {agent.toolCalls === 1 ? 'call' : 'calls'} so far{agent.toolErrors > 0 ? `, ${agent.toolErrors} failed` : ''}.
          </p>
          {agent.files.length > 0 && (
            <details className="files">
              <summary>
                {agent.files.length} {agent.files.length === 1 ? 'file' : 'files'} changed
              </summary>
              <ul>
                {agent.files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <p className="muted">No steps yet.</p>
      )}

      <OpenInClaudeCode snapshot={snapshot} company={company} actions={actions} announce={announce} online={online} p={p} />

      {p.level !== 'ceo' && (
        <div className="person-details__fire">
          <button type="button" className="button button--danger" aria-disabled={!online || firing || undefined} onClick={() => void fire()}>
            {firing ? `Firing ${name}…` : `Fire ${name}`}
          </button>
          <p className="muted">Their task goes back to their manager, and Undo is in place for a moment after.</p>
          {fireNote && <p className="person__problem">{fireNote}</p>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const BODY_NAMES: Record<(typeof LOOK_BODIES)[number], string> = {
  mannequin: 'Plain',
  knight: 'Sturdy',
  barbarian: 'Broad',
  mage: 'Tall',
  rogue: 'Slight',
  ranger: 'Lean',
};

function Levers({ snapshot, actions, announce, online, p, companyId, navigate }: Pick<Props, 'snapshot' | 'actions' | 'announce' | 'online' | 'p' | 'companyId' | 'navigate'>) {
  const id = useId();
  const [room, setRoom] = useState(p.room);
  const [body, setBody] = useState<string>(p.look.body ?? '');
  const [skin, setSkin] = useState<string>(p.look.skin === undefined ? '' : String(p.look.skin));
  const [prop, setProp] = useState<string>(p.look.prop ?? '');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const rooms = snapshot.studio?.departments ?? [];

  const look: Look = { ...p.look };
  if (body) look.body = body as Look['body'];
  else delete look.body;
  if (skin) look.skin = Number(skin);
  else delete look.skin;
  if (prop) look.prop = prop as Look['prop'];
  else delete look.prop;
  const changed = { room: room !== p.room, look: JSON.stringify(look) !== JSON.stringify(p.look) };
  const any = changed.room || changed.look;

  const save = async () => {
    if (!online || saving || !any) return;
    setSaving(true);
    setNote(null);
    const said: string[] = [];
    let ok = true;
    try {
      // One change at a time, stopping at the first the office turns down, so what is left still shows as a draft.
      if (changed.room) {
        const r = await actions.reshape({ action: 'move', role: p.id, department: room });
        said.push(r.message);
        ok = r.ok;
      }
      if (ok && changed.look) {
        const r = await actions.changeOffice({ change: 'look', person: p.id, look });
        said.push(r.message);
        ok = r.ok;
      }
    } catch (error) {
      ok = false;
      said.push(refusalOf(error));
    } finally {
      setSaving(false);
    }
    const text = said.join(' ');
    setNote({ text, ok });
    announce(text);
  };

  return (
    <section className="levers person-levers" aria-label={`${capital(called(p))}'s room and look`}>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-room`}>
          Room
        </label>
        <select id={`${id}-room`} value={room} disabled={saving || rooms.length === 0} onChange={(e) => setRoom(e.target.value)}>
          {rooms.length === 0 && <option value={p.room}>{titleFromId(p.room)}</option>}
          {rooms.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="person-levers__look">
        <legend className="field__label">Look</legend>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-body`}>
            Body
          </label>
          <select id={`${id}-body`} value={body} disabled={saving} onChange={(e) => setBody(e.target.value)}>
            <option value="">Picked by the office</option>
            {LOOK_BODIES.map((b) => (
              <option key={b} value={b}>
                {BODY_NAMES[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-skin`}>
            Skin
          </label>
          <select id={`${id}-skin`} value={skin} disabled={saving} onChange={(e) => setSkin(e.target.value)}>
            <option value="">Picked by the office</option>
            {Array.from({ length: SKIN_TONES }, (_, i) => (
              <option key={i} value={String(i)}>
                {i === 0 ? 'Lightest' : i === SKIN_TONES - 1 ? 'Darkest' : `Tone ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-prop`}>
            Prop
          </label>
          <select id={`${id}-prop`} value={prop} disabled={saving} onChange={(e) => setProp(e.target.value)}>
            <option value="">Picked by the office</option>
            {LOOK_PROPS.map((x) => (
              <option key={x} value={x}>
                {x === 'none' ? 'Nothing' : titleFromId(x)}
              </option>
            ))}
          </select>
        </div>
        <p className="muted person-levers__more">
          Outfit and hair are in{' '}
          <CompanyLink companyId={companyId} to="customize" navigate={navigate} className="link" focusKey={`person:${p.id}:customize`}>
            Customize the office
          </CompanyLink>
          .
        </p>
      </fieldset>
      {any && (
        <div className="levers__save">
          <p className="muted">Saving changes their agent file and studio.yaml. Their next step uses it.</p>
          <div className="levers__buttons">
            <button type="button" className="button button--primary" aria-disabled={!online || saving || undefined} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => {
                setRoom(p.room);
                setBody(p.look.body ?? '');
                setSkin(p.look.skin === undefined ? '' : String(p.look.skin));
                setProp(p.look.prop ?? '');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {note && <p className={note.ok ? 'person-levers__note' : 'person__problem'}>{note.text}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function OpenInClaudeCode({ snapshot, company, actions, announce, online, p }: Pick<Props, 'snapshot' | 'company' | 'actions' | 'announce' | 'online' | 'p'>) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const name = called(p);
  const Name = capital(name);
  const session = p.desk.sessionId;
  const away = p.desk.state === 'away';
  const folder = folderOf(snapshot, company, p);

  const go = async (back: boolean) => {
    if (!online || busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (back) {
        await actions.bringBack(p.id);
        announce(`${Name} is back at their desk.`);
      } else {
        await actions.handOver(p.id);
        announce(`${Name} is yours in Claude Code. Run the command in their folder.`);
      }
    } catch (error) {
      setNote(refusalOf(error));
      announce(refusalOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="handover" aria-labelledby={`handover-${p.id}`}>
      <h4 id={`handover-${p.id}`} className="person-details__sub">
        Open in Claude Code
      </h4>
      {!session ? (
        <p className="muted">{noSessionLine(p)}</p>
      ) : (
        <>
          <p>
            {away
              ? `${Name} has been with you in Claude Code since ${whenAt(p.desk.since).replace(/^(?:at|on) /, '')}, and messages to them wait. When you're done, close the session there and bring them back.`
              : `The office pauses ${name} and hands you the session. In a terminal, in this folder, run:`}
          </p>
          <div className="handover__line">
            <code className="handover__code">{folder}</code>
            <CopyButton text={folder} what="the folder" announce={announce} />
          </div>
          <div className="handover__line">
            <code className="handover__code">{resumeCommand(session)}</code>
            <CopyButton text={resumeCommand(session)} what="the command" announce={announce} />
          </div>
          <button type="button" className="button" aria-disabled={!online || busy || undefined} onClick={() => void go(away)}>
            {busy ? (away ? 'Bringing them back…' : 'Handing over…') : away ? `Bring ${name} back` : `Hand ${name} over`}
          </button>
          {note && <p className="person__problem">{note}</p>}
        </>
      )}
    </section>
  );
}
