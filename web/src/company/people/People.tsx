// People (docs/design-v3.md, "People and a person"): the org as an outline by who reports to whom, with what each person
// is doing in the desk-and-work table's words, then visitors and the people fired with Rehire. Since stage and dock the
// Org board (org/OrgBoard.tsx) is the org on every screen; this stays as the shell's fallback where that board is missing.
import { type CSSProperties, useId, useState } from 'react';
import type { FiredRole } from '../../../../src/core/studio.ts';
import { roomHue } from '../../hud/model.ts';
import { dollars } from '../../lib/format.ts';
import { inboxItemPath } from '../inbox/inboxModel.ts';
import { LeashBadge } from '../leash/LeashBadge.tsx';
import type { TabProps } from '../types.ts';
import { useCompanyClock } from './clock.ts';
import {
  called,
  findPeople,
  FIND_OVER,
  flatten,
  FOLD_OVER,
  foundLine,
  keepsOpen,
  type OrgNode,
  orgOutline,
  roomName,
  visitorsOf,
  workOf,
} from './peopleModel.ts';
import { CompanyLink, refusalOf, WorkRow } from './shared.tsx';

const YOU_HUE = 'var(--ink)';
const VISITOR_HUE = '#8C948F';

export function People({ snapshot, company, companyId, actions, steer, navigate, announce, online, openRoom, openVisitor }: TabProps) {
  const now = useCompanyClock(snapshot.serverTime, online);
  const findId = useId();
  const [query, setQuery] = useState('');
  // Folded rooms someone opened or closed; the rest follow the rule (open while someone there works or needs you).
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [rehiring, setRehiring] = useState<string | null>(null);
  const [rehired, setRehired] = useState<{ role: string; text: string; ok: boolean } | null>(null);

  const outline = orgOutline(snapshot, company);
  const total = company.people.length;
  const finding = total > FIND_OVER && query.trim() !== '';
  const found = finding ? findPeople(snapshot, outline, query) : [];
  const folding = total > FOLD_OVER && !finding;
  const visitors = visitorsOf(snapshot, company, now);
  const fired = snapshot.studio?.fired ?? [];
  const onlyCeo = total === 1 && company.people[0]?.level === 'ceo';
  const ceo = company.people.find((p) => p.level === 'ceo');

  const row = (node: OrgNode, depth: number) => {
    const p = node.person;
    const work = workOf(company, p, now);
    const stateId = `people-${p.id}-state`;
    return (
      <WorkRow
        hue={roomHue(snapshot, p.room)}
        depth={depth}
        name={
          <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(p.id)}`} navigate={navigate} className="work-row__link" focusKey={`people:${p.id}`} describedBy={stateId}>
            {p.name}
          </CompanyLink>
        }
        title={p.name === p.title ? undefined : p.title}
        cost={dollars(p.cost)}
        word={{ text: work.word, tone: work.tone }}
        badge={<LeashBadge company={company} person={p.id} />}
        lines={
          <>
            <p id={stateId} className="work-row__line">
              <span className="visually-hidden">{work.word}. </span>
              {work.line}
            </p>
            {work.problem && <p className="work-row__problem">{work.problem}</p>}
          </>
        }
        extra={
          work.item ? (
            <CompanyLink companyId={companyId} to={inboxItemPath(work.item)} navigate={navigate} className="link work-row__answer" label={`Answer ${called(p)}`} focusKey={`people:${p.id}:answer`}>
              Answer
            </CompanyLink>
          ) : undefined
        }
      />
    );
  };

  /** A person, then the people who report to them; a head's room name above them, and in a big company a fold. */
  const branch = (node: OrgNode, depth: number) => {
    const room = node.room;
    const open = folds[node.person.id] ?? keepsOpen(company, node, now);
    const below = node.children.length > 0 && <ul className="org__list">{node.children.map((n) => branch(n, depth + 1))}</ul>;
    const foldable = folding && room !== null && node.children.length > 0;
    const more = flatten(node.children).length;
    return (
      <li key={node.person.id} className="org__item">
        {room && (
          <h3 className="org__room" style={{ '--depth': depth } as CSSProperties}>
            {/* The room's name opens v2's room card: its people, rules and hiring. */}
            <button type="button" className="org__room-button" data-focus={`people:room:${room.id}`} onClick={() => openRoom(room.id)}>
              {room.name}
            </button>
          </h3>
        )}
        {row(node, depth)}
        {foldable ? (
          <details className="org__fold" open={open} onToggle={(e) => setFolds((f) => ({ ...f, [node.person.id]: e.currentTarget.open }))}>
            <summary style={{ '--depth': depth + 1 } as CSSProperties}>
              {more} more in {room.name}
            </summary>
            {below}
          </details>
        ) : (
          below
        )}
      </li>
    );
  };

  const rehire = async (role: FiredRole) => {
    if (!online || rehiring) return;
    setRehiring(role.id);
    setRehired(null);
    try {
      const result = await actions.reshape({ action: 'rehire', role: role.id });
      setRehired({ role: role.id, text: result.message, ok: result.ok });
      announce(result.message);
    } catch (error) {
      const text = `Couldn't rehire ${role.name ?? role.title}: ${refusalOf(error)}`;
      setRehired({ role: role.id, text, ok: false });
      announce(text);
    } finally {
      setRehiring(null);
    }
  };

  return (
    <div className="people">
      {total > FIND_OVER && (
        <div className="find">
          <label className="find__label" htmlFor={findId}>
            Find someone
          </label>
          <input
            id={findId}
            className="find__box"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            spellCheck={false}
            value={query}
            aria-describedby={finding ? `${findId}-count` : undefined}
            onChange={(e) => setQuery(e.target.value)}
          />
          {finding && (
            <p id={`${findId}-count`} className="find__count">
              {foundLine(found.length, total)}
            </p>
          )}
        </div>
      )}

      {finding ? (
        found.length === 0 ? (
          <p className="rows__empty">Nobody is called that. Try a title or a room.</p>
        ) : (
          <ul className="org__list org__list--found" aria-label="People found">
            {found.map((n) => (
              <li key={n.person.id} className="org__item">
                {row(n, 0)}
                <p className="org__where">{roomName(snapshot, n.person.room)}</p>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="org__list org" aria-label="The org">
          <li className="org__item">
            <div className="org__you" style={{ '--hue': YOU_HUE } as CSSProperties}>
              <span className="work-row__marker" aria-hidden="true" />
              <span>
                <span className="org__you-name">You</span>
                {company.stakeholder && <span className="org__you-who">{company.stakeholder}</span>}
              </span>
            </div>
            {outline.length > 0 && <ul className="org__list">{outline.map((n) => branch(n, 1))}</ul>}
          </li>
        </ul>
      )}

      {steer && total > 1 && (
        <p className="people__send">
          <CompanyLink companyId={companyId} to="send" navigate={navigate} className="link" focusKey="people:send">
            Message a room or everyone
          </CompanyLink>
        </p>
      )}

      {onlyCeo && ceo && (
        <div className="people__empty">
          <p>Only the CEO is left. Tell the CEO who to hire.</p>
          <CompanyLink companyId={companyId} to={`people/${encodeURIComponent(ceo.id)}/message`} navigate={navigate} className="button" focusKey="people:message-ceo">
            Message the CEO
          </CompanyLink>
        </div>
      )}

      {visitors.length > 0 && (
        <section className="people__section" aria-labelledby="people-visitors">
          <h3 id="people-visitors" className="group-title">
            Visitors
          </h3>
          <p className="group-note">Claude Code sessions in this folder that the company didn't start.</p>
          <ul className="org__list">
            {visitors.map((v) => (
              <li key={v.key} className="org__item">
                <WorkRow
                  hue={VISITOR_HUE}
                  name={
                    // A visitor opens v2's badge, with Ask aside.
                    <button type="button" className="work-row__link work-row__button" data-focus={`people:visitor:${v.key}`} aria-describedby={`people-visitor-${v.key}`} onClick={() => openVisitor(v.key)}>
                      {v.name}
                    </button>
                  }
                  cost={dollars(v.cost)}
                  lines={
                    <p id={`people-visitor-${v.key}`} className="work-row__line">
                      <span className="work-row__word">{v.word}.</span> {v.line}
                    </p>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {fired.length > 0 && (
        <details className="fold people__fired">
          <summary>Fired ({fired.length})</summary>
          <ul className="fired">
            {fired.map((f) => (
              <li key={f.id} className="fired__row">
                <span className="fired__who">
                  <span className="fired__name">{f.name ?? f.title}</span>
                  {f.name && f.name !== f.title && <span className="fired__title">{f.title}</span>}
                </span>
                <button
                  type="button"
                  className="button fired__rehire"
                  aria-disabled={!online || rehiring !== null || undefined}
                  aria-label={`Rehire ${f.name ?? f.title}`}
                  onClick={() => void rehire(f)}
                >
                  {rehiring === f.id ? 'Rehiring…' : 'Rehire'}
                </button>
                {rehired?.role === f.id && <p className={rehired.ok ? 'fired__note' : 'fired__note fired__note--failed'}>{rehired.text}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Back in the org, they leave the fold (which goes with its last person): the result stays in view here. */}
      {rehired && !fired.some((f) => f.id === rehired.role) && <p className="note people__rehired">{rehired.text}</p>}
    </div>
  );
}
