// The payroll: what each role and room has cost, who is idle, and what to do about it.
import { payroll } from '../../../src/core/payroll.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import type { Selection } from '../scene/Building.tsx';
import { dollars, percent, tokens } from '../lib/format.ts';
import { officeCalls, roomHue } from './model.ts';

export function PayrollBoard({ snapshot, onSelect }: { snapshot: Snapshot; onSelect: (s: Selection) => void }) {
  const p = payroll(snapshot.agents, snapshot.studio, snapshot.archived.people, snapshot.aside.spend);
  const titleOf = (id: string) => snapshot.studio?.roles.find((r) => r.id === id)?.title ?? id;
  // Leads and contractors open their latest agent; a line from an earlier session may have nobody left to open.
  const agentTarget = (id: string, kind: string): Selection | null => {
    const agent = [...snapshot.agents].reverse().find((a) => (kind === 'lead' ? a.kind === 'lead' : a.kind === 'contractor' && a.agentType === id));
    return agent ? { kind: 'agent', key: agent.key } : null;
  };
  const usage = snapshot.totals.usage;
  return (
    <div className="payroll">
      <p className="payroll__total">
        <span className="payroll__total-figure">{dollars(p.total.cost)}</span>
        <span className="payroll__total-label">
          {snapshot.totals.costExact ? 'spent, as reported by Claude Code' : `API-equivalent for ${tokens(p.total.tokens)} tokens, at list prices of ${snapshot.pricesAsOf}`}
        </span>
      </p>
      {p.total.tokens > 0 && (
        <p className="payroll__split">
          {tokens(usage.input)} input, {tokens(usage.output)} output, {tokens(usage.cacheRead)} cache reads and{' '}
          {tokens(usage.cacheWrite5m + usage.cacheWrite1h)} cache writes.
          {snapshot.archived.sessions > 0 && ` Includes ${snapshot.archived.sessions} earlier ${snapshot.archived.sessions === 1 ? 'session' : 'sessions'}.`}
        </p>
      )}
      {snapshot.totals.unpricedTokens > 0 && <p className="note">{tokens(snapshot.totals.unpricedTokens)} tokens came from models without a known price and aren't counted.</p>}

      {p.lines.length === 0 ? (
        <p className="rows__empty">Nobody has worked yet. Costs appear as soon as a session uses tokens.</p>
      ) : (
        <table className="ledger-table">
          <caption className="visually-hidden">Cost per role</caption>
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col" className="num">Share</th>
              <th scope="col" className="num">Tokens</th>
              <th scope="col" className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => {
              // The office's own spend: pinned under the roles after a rule, and not a button, since it has no badge.
              if (l.kind === 'office') {
                return (
                  <tr key="office" className="ledger-table__office">
                    <th scope="row">
                      {l.title}
                      <span className="ledger-table__sub">{officeCalls(snapshot.aside.spend)}</span>
                    </th>
                    <td className="num">
                      <span className="share" style={{ ['--share' as string]: `${Math.round(l.share * 100)}%`, ['--hue' as string]: '#8C948F' }}>{percent(l.share)}</span>
                    </td>
                    <td className="num">{tokens(l.tokens)}</td>
                    <td className="num">{dollars(l.cost)}</td>
                  </tr>
                );
              }
              const target: Selection | null = l.kind === 'role' ? { kind: 'role', id: l.id } : agentTarget(l.id, l.kind);
              return (
                <tr key={`${l.kind}:${l.id}`}>
                  <th scope="row">
                    {target ? (
                      <button type="button" className="link" onClick={() => onSelect(target)}>{l.kind === 'role' ? titleOf(l.id) : l.title}</button>
                    ) : (
                      l.title
                    )}
                    {l.shifts > 1 && <span className="ledger-table__sub">{l.shifts} calls</span>}
                  </th>
                  <td className="num">
                    <span className="share" style={{ ['--share' as string]: `${Math.round(l.share * 100)}%`, ['--hue' as string]: l.kind === 'lead' ? '#C9B458' : roomHue(snapshot, l.department) }}>
                      {percent(l.share)}
                    </span>
                  </td>
                  <td className="num">{tokens(l.tokens)}</td>
                  <td className="num">{dollars(l.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {p.advice.length > 0 && (
        <section aria-labelledby="payroll-advice">
          <h3 id="payroll-advice" className="group-title">Worth a look</h3>
          <ul className="advice">
            {p.advice.map((a) => (
              <li key={`${a.kind}:${a.roleId}`} className={`advice__item advice__item--${a.kind}`}>
                <span className="advice__who">
                  {a.roleIds.map((id, i) => (
                    <span key={id}>
                      {i > 0 && (i === a.roleIds.length - 1 ? ' and ' : ', ')}
                      <button type="button" className="link" onClick={() => onSelect({ kind: 'role', id })}>{titleOf(id)}</button>
                    </span>
                  ))}
                </span>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.rooms.some((r) => r.cost > 0) && (
        <section aria-labelledby="payroll-rooms">
          <h3 id="payroll-rooms" className="group-title">By room</h3>
          <ul className="rooms-bar">
            {p.rooms.filter((r) => r.cost > 0).map((r) => (
              <li key={r.id} style={{ ['--hue' as string]: roomHue(snapshot, r.id), ['--share' as string]: `${Math.max(2, Math.round(r.share * 100))}%` }}>
                <button type="button" className="link" onClick={() => onSelect({ kind: 'room', id: r.id })}>{r.name}</button>
                <span className="rooms-bar__value">{dollars(r.cost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
